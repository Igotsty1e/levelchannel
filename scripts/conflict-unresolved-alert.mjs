#!/usr/bin/env node
//
// BCS-DEF-1 Phase 2 — Conflict-unresolved alert probe.
//
// Sibling of scripts/auth-flow-alert.mjs and scripts/calendar-pathology-alert.mjs.
// Runs on the VPS as a systemd timer (default every 30 minutes) and
// emails the operator when any teacher's booked future slot has carried
// an unresolved `external_conflict_at` stamp for ≥ N minutes
// (default 120, operator-tunable via /admin/settings/alerts).
//
// Source of truth for the predicate: docs/plans/conflict-unresolved-alert.md.
// Conflict stamping itself lives in lib/calendar/conflict-detector.ts,
// wired into pull-worker.processOneJob() (PR #251, 2026-05-17).
//
// Why a separate cron from the pull-worker: alerting is a different
// concern (operator notification) with a different cadence (slow,
// deduped) than the detection (every pull-tick). Coupling them would
// mean either over-paging or under-detection.
//
// Operator-tunable thresholds (DB → env → default), per
// lib/admin/operator-settings.ts SETTING_SCHEMA + scripts/lib/
// operator-settings.mjs mirror:
//
//   CONFLICT_UNRESOLVED_THRESHOLD_MINUTES     default 120  min:5  max:1440
//   CONFLICT_UNRESOLVED_REPORT_LIMIT          default 50   min:1  max:500
//   CONFLICT_UNRESOLVED_PER_TEACHER_LIMIT     default 5    min:1  max:50
//   CONFLICT_UNRESOLVED_DEDUP_WINDOW_MS       default 4h   min:60s max:7d
//
// Other env:
//   DATABASE_URL          — postgres connection
//   RESEND_API_KEY        — Resend SDK key (else email skipped, only journal)
//   EMAIL_FROM            — sender (reused from main app)
//   ALERT_EMAIL_TO        — destination (operator)
//   NEXT_PUBLIC_SITE_URL  — used to build /admin/accounts deep-links
//
// Failure mode + idempotence (mirrors sibling probes):
//   - PG outage → throw → systemd captures non-zero, no email
//   - Resend outage → email fails, journal carries warning, state file
//     NOT advanced (next tick re-fires for the same offender set)
//   - Dedup-window state file prevents re-paging on same offender-set
//
// Module shape: helpers (`fingerprint`, `buildEmail`,
// `readOffenderRows`, `readOffenderCounts`) are NAMED EXPORTS so unit
// tests can import them without invoking `main()`. The `if
// (invokedDirectly) { main() }` guard at the bottom matches the
// auth-flow / webhook-flow pattern (calendar-pathology's missing
// guard is sibling debt, NOT propagated here).

import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve as resolvePath } from 'node:path'

import pg from 'pg'
import { Resend } from 'resend'

import { resolveSslConfig } from './_pg-ssl.mjs'
import {
  resolveChannelSettings,
  resolveOperatorSettingsForProbe,
} from './lib/operator-settings.mjs'
import { pluralRu } from './lib/plural-ru.mjs'
import {
  recordProbeRun,
  PROBE_NAMES,
  RECIPIENT_KINDS,
  VERDICT_KINDS,
} from './lib/probe-runs.mjs'
import {
  redactTelegramSecret,
  sendTelegramMessage,
  stringifyTelegramError,
} from './lib/telegram-alerts.mjs'

// Module-scope `let` — resolved from operator_settings at tick start
// so buildEmail() can reference the values for the "Внутрипробные
// пороги" footer line. Wave-paranoia round-1 BLOCKER #1 on the
// calendar-pathology sibling pinned this shape (earlier draft used
// `const` inside main() which broke buildEmail with ReferenceError
// on the actual alert path).
let THRESHOLD_MINUTES = 120
let REPORT_LIMIT = 50
let PER_TEACHER_LIMIT = 5
let DEDUP_WINDOW_MS = 4 * 3600 * 1000

// bcs-def-1-fanout impl — env-driven fan-out knobs (plan §2.5 + §0g).
// All default OFF / conservative. Activation = operator flips
// CONFLICT_UNRESOLVED_TEACHER_FANOUT_ENABLED=1 in the env file (both
// the probe systemd unit AND the next-server unit must agree on
// CONFLICT_UNRESOLVED_STATE_FILE per plan §0f/§0g — single canonical
// `<APP_DIR>/var/conflict-unresolved-state.json`).
const TEACHER_FANOUT_ENABLED =
  (process.env.CONFLICT_UNRESOLVED_TEACHER_FANOUT_ENABLED ?? '').trim() === '1'
const TEACHER_FANOUT_CAP = Math.max(
  1,
  Number.parseInt(
    process.env.CONFLICT_UNRESOLVED_TEACHER_FANOUT_CAP ?? '100',
    10,
  ) || 100,
)
const TEACHER_DEDUP_WINDOW_MS = Math.max(
  60_000,
  Number.parseInt(
    process.env.CONFLICT_UNRESOLVED_TEACHER_DEDUP_WINDOW_MS ?? `${12 * 3600 * 1000}`,
    10,
  ) || 12 * 3600 * 1000,
)

const STATE_FILE = process.env.CONFLICT_UNRESOLVED_STATE_FILE
  ? resolvePath(process.env.CONFLICT_UNRESOLVED_STATE_FILE)
  : resolvePath('./var/conflict-unresolved-state.json')

const ALERT_EMAIL_TO = process.env.ALERT_EMAIL_TO?.trim() || ''
const EMAIL_FROM =
  process.env.EMAIL_FROM?.trim() || 'LevelChannel <noreply@example.com>'
const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.trim() || 'https://levelchannel.ru'

// BCS-DEF-1-TG (2026-05-19) — Telegram channel env (plan §2.2).
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN?.trim() || ''
const TELEGRAM_ALERT_CHAT_ID =
  process.env.TELEGRAM_ALERT_CHAT_ID?.trim() || ''

function logJson(level, msg, extra = {}) {
  console.log(
    JSON.stringify({
      level,
      ts: new Date().toISOString(),
      probe: 'conflict-unresolved-alert',
      msg,
      ...extra,
    }),
  )
}

// --- DB readers ------------------------------------------------------

// Total offender count (UNBOUNDED) + distinct teacher count.
// Used for the email header line + the "и ещё N не показано" calc.
export async function readOffenderCounts(pool, thresholdMinutes) {
  const r = await pool.query(
    `select count(*)::int as total,
            count(distinct teacher_account_id)::int as teachers_total
       from lesson_slots s
       join accounts a on a.id = s.teacher_account_id
      where s.external_conflict_at is not null
        and s.external_conflict_at <= now() - ($1::int || ' minutes')::interval
        and s.status = 'booked'
        and s.start_at > now()
        and a.purged_at is null
        and a.disabled_at is null
        and a.email is not null
        and a.email <> ''`,
    [thresholdMinutes],
  )
  return {
    totalConflicts: Number(r.rows[0]?.total ?? 0),
    totalTeachers: Number(r.rows[0]?.teachers_total ?? 0),
  }
}

// Bounded offender rows. Window function per docs/plans/conflict-
// unresolved-alert.md §2.2: ROW_NUMBER OVER (PARTITION BY teacher,
// ORDER BY external_conflict_at) → per-teacher cap → global cap.
// Prevents one noisy teacher from monopolizing the report (round-2
// BLOCKER #2 closure).
export async function readOffenderRows(
  pool,
  thresholdMinutes,
  perTeacherLimit,
  reportLimit,
) {
  const r = await pool.query(
    `with offenders as (
       select
         s.id                          as slot_id,
         s.teacher_account_id,
         s.start_at,
         s.duration_minutes,
         s.external_conflict_at,
         s.conflict_source_calendar_id,
         s.conflict_source_event_id,
         a.email                       as teacher_email,
         row_number() over (
           partition by s.teacher_account_id
           order by s.external_conflict_at asc, s.start_at asc
         ) as rn_per_teacher
       from lesson_slots s
       join accounts a on a.id = s.teacher_account_id
        where s.external_conflict_at is not null
          and s.external_conflict_at <= now() - ($1::int || ' minutes')::interval
          and s.status = 'booked'
          and s.start_at > now()
          and a.purged_at is null
          and a.disabled_at is null
          and a.email is not null
          and a.email <> ''
     )
     select slot_id, teacher_account_id, start_at, duration_minutes,
            external_conflict_at, conflict_source_calendar_id,
            conflict_source_event_id, teacher_email, rn_per_teacher
       from offenders
      where rn_per_teacher <= $2::int
      order by external_conflict_at asc, teacher_account_id, start_at
      limit $3::int`,
    [thresholdMinutes, perTeacherLimit, reportLimit],
  )
  return r.rows.map((row) => ({
    slotId: String(row.slot_id),
    teacherAccountId: String(row.teacher_account_id),
    startAt: new Date(String(row.start_at)).toISOString(),
    durationMinutes: Number(row.duration_minutes),
    externalConflictAt: new Date(String(row.external_conflict_at)).toISOString(),
    conflictSourceCalendarId: row.conflict_source_calendar_id
      ? String(row.conflict_source_calendar_id)
      : null,
    conflictSourceEventId: row.conflict_source_event_id
      ? String(row.conflict_source_event_id)
      : null,
    teacherEmail: String(row.teacher_email),
    rnPerTeacher: Number(row.rn_per_teacher),
  }))
}

// UNBOUNDED qualifying-set read for fingerprint. Wave-paranoia round-1
// BLOCKER#2 closure (2026-05-19): the fingerprint MUST be computed over
// the FULL qualifying offender set, not the truncated visible slice
// returned by `readOffenderRows()`. Otherwise saturation (51st conflict
// or 6th conflict at a teacher already capped at 5) doesn't change the
// fingerprint and the probe dedup-skip-s for 4h even though the real
// offender set has grown — defeating the entire >threshold alert
// semantics.
//
// Returns the MINIMAL tuple set needed for fingerprint stability
// (teacherAccountId, slotId, conflictSourceCalendarId, conflictSourceEventId)
// across ALL qualifying rows. No LIMIT clause — at SaaS scale this might
// be hundreds of rows; sha256 over a few KB of string is cheap (<1ms).
export async function readFingerprintTuples(pool, thresholdMinutes) {
  const r = await pool.query(
    `select s.id                          as slot_id,
            s.teacher_account_id,
            s.conflict_source_calendar_id,
            s.conflict_source_event_id
       from lesson_slots s
       join accounts a on a.id = s.teacher_account_id
      where s.external_conflict_at is not null
        and s.external_conflict_at <= now() - ($1::int || ' minutes')::interval
        and s.status = 'booked'
        and s.start_at > now()
        and a.purged_at is null
        and a.disabled_at is null
        and a.email is not null
        and a.email <> ''`,
    [thresholdMinutes],
  )
  return r.rows.map((row) => ({
    slotId: String(row.slot_id),
    teacherAccountId: String(row.teacher_account_id),
    conflictSourceCalendarId: row.conflict_source_calendar_id
      ? String(row.conflict_source_calendar_id)
      : null,
    conflictSourceEventId: row.conflict_source_event_id
      ? String(row.conflict_source_event_id)
      : null,
  }))
}

// bcs-def-1-fanout impl — UNBOUNDED teacher-grouped offender read for
// the fan-out path. Plan §0b Closure #1: operator email keeps the
// existing truncated `readOffenderRows()` view; fan-out builds on the
// FULL qualifying set so teachers past the operator cap still get
// paged. Returns one row per offender — caller groups by teacher.
export async function readAllOffendersForFanout(pool, thresholdMinutes) {
  const r = await pool.query(
    `select s.id                          as slot_id,
            s.teacher_account_id,
            s.start_at,
            s.duration_minutes,
            s.external_conflict_at,
            s.conflict_source_calendar_id,
            s.conflict_source_event_id,
            a.email                       as teacher_email
       from lesson_slots s
       join accounts a on a.id = s.teacher_account_id
      where s.external_conflict_at is not null
        and s.external_conflict_at <= now() - ($1::int || ' minutes')::interval
        and s.status = 'booked'
        and s.start_at > now()
        and a.purged_at is null
        and a.disabled_at is null
        and a.email is not null
        and a.email <> ''
      order by s.teacher_account_id, s.external_conflict_at asc, s.start_at asc`,
    [thresholdMinutes],
  )
  return r.rows.map((row) => ({
    slotId: String(row.slot_id),
    teacherAccountId: String(row.teacher_account_id),
    startAt: new Date(String(row.start_at)).toISOString(),
    durationMinutes: Number(row.duration_minutes),
    externalConflictAt: new Date(String(row.external_conflict_at)).toISOString(),
    conflictSourceCalendarId: row.conflict_source_calendar_id
      ? String(row.conflict_source_calendar_id)
      : null,
    conflictSourceEventId: row.conflict_source_event_id
      ? String(row.conflict_source_event_id)
      : null,
    teacherEmail: String(row.teacher_email),
  }))
}

// Group flat offender array by teacher_account_id. Preserves input order.
export function groupOffendersByTeacher(offenders) {
  const byTeacher = new Map()
  for (const o of offenders) {
    if (!byTeacher.has(o.teacherAccountId)) {
      byTeacher.set(o.teacherAccountId, {
        teacherAccountId: o.teacherAccountId,
        teacherEmail: o.teacherEmail,
        slots: [],
      })
    }
    byTeacher.get(o.teacherAccountId).slots.push(o)
  }
  return byTeacher
}

// Per-teacher fingerprint over (slotId, calendarId, eventId) tuples —
// teacher_account_id is the group key, contributes nothing to the hash.
// Same sha256 shape as the operator fingerprint to keep dedup semantics
// consistent.
export function perTeacherFingerprint(slots) {
  const items = slots
    .map(
      (s) =>
        `${s.slotId}|${s.conflictSourceCalendarId ?? ''}|${s.conflictSourceEventId ?? ''}`,
    )
    .sort()
  return createHash('sha256').update(items.join('\n')).digest('hex').slice(0, 16)
}

// Per-teacher omitted count — rows that exceeded per_teacher_limit.
// Used for the "и ещё N конфликтов не показано у этого учителя" line.
export async function readPerTeacherOmittedCounts(
  pool,
  thresholdMinutes,
  perTeacherLimit,
) {
  const r = await pool.query(
    `with offenders as (
       select s.teacher_account_id,
              row_number() over (
                partition by s.teacher_account_id
                order by s.external_conflict_at asc, s.start_at asc
              ) as rn
         from lesson_slots s
         join accounts a on a.id = s.teacher_account_id
        where s.external_conflict_at is not null
          and s.external_conflict_at <= now() - ($1::int || ' minutes')::interval
          and s.status = 'booked'
          and s.start_at > now()
          and a.purged_at is null
          and a.disabled_at is null
          and a.email is not null
          and a.email <> ''
     )
     select teacher_account_id, count(*)::int as omitted
       from offenders
      where rn > $2::int
      group by teacher_account_id`,
    [thresholdMinutes, perTeacherLimit],
  )
  const map = new Map()
  for (const row of r.rows) {
    map.set(String(row.teacher_account_id), Number(row.omitted))
  }
  return map
}

// --- Pure helpers (exported for unit tests) --------------------------

// sha256 over sorted full tuples — captures any change in the offender
// set: new slot, removed slot, same slot moved to a different conflict
// source. Round-1 BLOCKER #5 + round-2 fingerprint closure.
export function fingerprint(offenders) {
  const repr = offenders
    .map((o) =>
      [
        o.teacherAccountId,
        o.slotId,
        o.conflictSourceCalendarId ?? '',
        o.conflictSourceEventId ?? '',
      ].join(':'),
    )
    .sort()
    .join('|')
  return createHash('sha256').update(repr).digest('hex').slice(0, 16)
}

function formatMsk(iso) {
  return new Date(iso).toLocaleString('ru-RU', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function ageHumane(externalConflictAtIso) {
  const ageMs = Date.now() - new Date(externalConflictAtIso).getTime()
  if (ageMs < 0) return '0m назад'
  const h = Math.floor(ageMs / 3_600_000)
  const m = Math.floor((ageMs % 3_600_000) / 60_000)
  if (h === 0) return `${m}m назад`
  if (m === 0) return `${h}h назад`
  return `${h}h ${m}m назад`
}

// Build operator email body — groups offenders by teacher, includes
// per-teacher deep-link to /admin/accounts/<id> for actionable
// follow-up. Round-3 §0c BLOCKER closure: email copy honest about
// what the deep-link shows.
export function buildEmail(offenders, counts, perTeacherOmitted) {
  const { totalConflicts, totalTeachers } = counts

  // Group by teacher (preserve order from offenders[] which is already
  // sorted by external_conflict_at asc).
  const byTeacher = new Map()
  for (const o of offenders) {
    if (!byTeacher.has(o.teacherAccountId)) {
      byTeacher.set(o.teacherAccountId, {
        teacherAccountId: o.teacherAccountId,
        teacherEmail: o.teacherEmail,
        slots: [],
      })
    }
    byTeacher.get(o.teacherAccountId).slots.push(o)
  }

  const blocks = []
  for (const [, group] of byTeacher) {
    const omitted = perTeacherOmitted.get(group.teacherAccountId) ?? 0
    const accountUrl = `${SITE_URL}/admin/accounts/${group.teacherAccountId}`
    const totalForTeacher = group.slots.length + omitted
    const header =
      `— учитель ${group.teacherEmail} (${totalForTeacher} ${pluralRu(
        totalForTeacher,
        'конфликт',
        'конфликта',
        'конфликтов',
      )}; страница учителя: ${accountUrl} — там статус/роли/биллинг/учащиеся + контактный email)`
    const slotLines = group.slots.map(
      (s) =>
        `   • слот ${s.slotId}\n` +
        `     время ${formatMsk(s.startAt)} MSK (${s.durationMinutes} мин)\n` +
        `     конфликт стамплен ${formatMsk(s.externalConflictAt)} MSK (${ageHumane(s.externalConflictAt)})\n` +
        `     источник Google calendar=${s.conflictSourceCalendarId ?? '—'} event=${s.conflictSourceEventId ?? '—'}`,
    )
    const omittedLine =
      omitted > 0
        ? `   ... и ещё ${omitted} ${pluralRu(omitted, 'конфликт', 'конфликта', 'конфликтов')} у этого учителя не показано (увеличьте CONFLICT_UNRESOLVED_PER_TEACHER_LIMIT в /admin/settings/alerts если нужны все).`
        : null
    blocks.push(
      [header, ...slotLines, omittedLine].filter(Boolean).join('\n'),
    )
  }

  const subject = `[LevelChannel] Нерешённые конфликты с Google-календарём: ${totalConflicts} ${pluralRu(totalConflicts, 'конфликт', 'конфликта', 'конфликтов')} у ${totalTeachers} ${pluralRu(totalTeachers, 'учителя', 'учителей', 'учителей')} (порог ${formatHours(THRESHOLD_MINUTES)})`

  const text = [
    'LevelChannel — конфликты расписания, не разрешённые в течение',
    `${formatHours(THRESHOLD_MINUTES)} (operator-настройка CONFLICT_UNRESOLVED_THRESHOLD_MINUTES).`,
    '',
    `Всего конфликтов: ${totalConflicts} у ${totalTeachers} ${pluralRu(totalTeachers, 'учителя', 'учителей', 'учителей')}.`,
    `Показано: до ${PER_TEACHER_LIMIT} на учителя × ${REPORT_LIMIT} всего.`,
    '',
    'По учителям (отсортировано по самому старому конфликту):',
    '',
    blocks.join('\n\n'),
    '',
    'Действие: открыть страницу учителя по ссылке выше (статус/роли/',
    'биллинг/учащиеся) и связаться с учителем напрямую (email слева).',
    'Список слотов и отмена — через /admin/slots; используйте slot ID',
    'из этого письма (grep по странице или прямой psql lookup). Если',
    'событие в Google уже удалено, конфликт очистится автоматически',
    'на следующем pull-worker тике (~30 минут).',
    '',
    `По состоянию на ${new Date().toISOString()}.`,
    `Внутрипробные пороги: threshold=${THRESHOLD_MINUTES} min, per_teacher_limit=${PER_TEACHER_LIMIT}, report_limit=${REPORT_LIMIT}, dedup_window=${formatHours((DEDUP_WINDOW_MS / 60_000) | 0)}.`,
    '',
    '— LevelChannel ops',
  ].join('\n')

  return { subject, text }
}

// Per-teacher email body for the fan-out branch. Privacy invariant
// (plan §0b Closure #6 + §0c Closure #3): contains ONLY this teacher's
// own slots — no other teachers' slot IDs, emails, or any cross-teacher
// metadata. Tests assert this with a negative grep.
export function buildTeacherEmail(group, thresholds) {
  const total = group.slots.length
  const slotLines = group.slots.map(
    (s) =>
      `   • слот ${s.slotId}\n` +
      `     время ${formatMsk(s.startAt)} MSK (${s.durationMinutes} мин)\n` +
      `     конфликт стамплен ${formatMsk(s.externalConflictAt)} MSK (${ageHumane(s.externalConflictAt)})\n` +
      `     источник Google calendar=${s.conflictSourceCalendarId ?? '—'} event=${s.conflictSourceEventId ?? '—'}`,
  )
  const subject = `[LevelChannel] У вас ${total} ${pluralRu(total, 'нерешённый конфликт', 'нерешённых конфликта', 'нерешённых конфликтов')} с Google-календарём`
  const text = [
    'LevelChannel — нерешённые конфликты вашего расписания с Google-календарём.',
    '',
    `У вас ${total} ${pluralRu(total, 'конфликт', 'конфликта', 'конфликтов')} старше ${formatHours(thresholds.thresholdMinutes)}.`,
    '',
    'Слоты:',
    '',
    ...slotLines,
    '',
    'Действие: откройте кабинет LevelChannel и решите по каждому слоту —',
    'либо отмените урок (если в Google событие реальное), либо удалите',
    'событие в Google (если оно ошибочное). Список синхронизируется',
    'автоматически на следующем pull-worker тике (~30 минут).',
    '',
    `Кабинет: ${SITE_URL}/teacher/calendar`,
    '',
    `По состоянию на ${new Date().toISOString()}.`,
    '',
    '— LevelChannel',
  ].join('\n')
  return { subject, text }
}

// pluralRu was inlined here pre-BCS-DEF-5 (2026-05-19); extracted to
// scripts/lib/plural-ru.mjs so the daily-digest cron + this probe share
// the helper. Drift test (tests/scripts/plural-ru.test.ts) pins TS ↔
// mjs equality.

// BCS-DEF-1-TG (2026-05-19) — Telegram body (plan §2.3, §4.5).
// 4-line digest + deep-link; no teacher emails, no slot IDs, no
// calendar/event IDs (PII guard).
export function buildTelegramBody(counts) {
  const { totalConflicts, totalTeachers } = counts
  const lines = [
    'LevelChannel ops — conflict-unresolved',
    `${totalConflicts} нерешённых конфликтов у ${totalTeachers} ${pluralRu(totalTeachers, 'учителя', 'учителей', 'учителей')} (старше ${formatHours(THRESHOLD_MINUTES)})`,
    `Подробнее: ${SITE_URL}/admin/settings/alerts`,
  ]
  return lines.join('\n')
}

function formatHours(minutes) {
  if (minutes < 60) return `${minutes} мин`
  if (minutes % 60 === 0) return `${minutes / 60} ч`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${h}ч ${m}мин`
}

// --- State file --------------------------------------------------------

// State file shape (bcs-def-1-fanout impl, plan §0b Closure #5 — additive):
//   v1 (legacy): { lastAlertAt: number | null, lastFingerprint: string | null }
//   v2: v1 keys PLUS perTeacher: {
//     [teacherId]: {
//       lastAlertAt: number | null,     // wall-clock of last successful fan-out send
//       lastFingerprint: string | null,
//       lastAttemptAt: number | null,   // wall-clock of last cap-rotation attempt
//     }
//   }
// Old reader sees v1 keys and continues operator dedup; ignores the
// unknown perTeacher key. New reader populates both halves.
async function readState() {
  try {
    const raw = await readFile(STATE_FILE, 'utf8')
    const parsed = JSON.parse(raw)
    return {
      lastAlertAt: parsed.lastAlertAt ?? null,
      lastFingerprint: parsed.lastFingerprint ?? null,
      perTeacher:
        parsed.perTeacher && typeof parsed.perTeacher === 'object'
          ? parsed.perTeacher
          : {},
    }
  } catch {
    return { lastAlertAt: null, lastFingerprint: null, perTeacher: {} }
  }
}

// Atomic writer (plan §0f WARN #3 closure + §0b Closure #5).
// rename(2) is POSIX-atomic — admin reader (lib/admin/probe-status.ts)
// always sees EITHER the old JSON OR the new JSON, never a partial
// buffer. `.tmp.<pid>` suffix avoids collision if multiple invocations
// overlap (cron-tick + manual probe).
async function writeState(state) {
  await mkdir(dirname(STATE_FILE), { recursive: true })
  const tmp = `${STATE_FILE}.tmp.${process.pid}`
  await writeFile(tmp, JSON.stringify(state, null, 2), 'utf8')
  await rename(tmp, STATE_FILE)
}

// --- Main --------------------------------------------------------------

// BCS-DEF-1-TG R2 BLOCKER#2 closure (2026-05-19) — extract the inline
// email block into a per-probe helper to fit the gather-then-dispatch
// shape. Return contract `{ok, error, detail?, emailId?}` mirrors the
// sibling probes.
async function tryEmailChannel({ offenders, counts, perTeacherOmitted }) {
  if (!ALERT_EMAIL_TO || !process.env.RESEND_API_KEY) {
    return {
      ok: false,
      error: !ALERT_EMAIL_TO
        ? 'missing_alert_email_to'
        : 'missing_resend_api_key',
    }
  }
  const { subject, text } = buildEmail(offenders, counts, perTeacherOmitted)
  const resend = new Resend(process.env.RESEND_API_KEY)
  let sent
  try {
    sent = await resend.emails.send({
      from: EMAIL_FROM,
      to: [ALERT_EMAIL_TO],
      subject,
      text,
    })
  } catch (transportErr) {
    const detail =
      transportErr instanceof Error ? transportErr.message : String(transportErr)
    return { ok: false, error: 'resend_send_failed', detail }
  }
  if (sent.error) {
    return {
      ok: false,
      error: 'resend_send_failed',
      detail: String(sent.error),
    }
  }
  return { ok: true, emailId: sent.data?.id ?? null }
}

// BCS-DEF-1-TG (2026-05-19) — Telegram channel dispatch (plan §2.6.1).
async function tryTelegramChannel({
  pool,
  telegramBody,
  fingerprint,
  enrichedStats,
  retryMax,
}) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_ALERT_CHAT_ID) {
    const detail = !TELEGRAM_BOT_TOKEN
      ? 'missing_telegram_bot_token'
      : 'missing_telegram_alert_chat_id'
    logJson('warn', 'Telegram channel: env missing; recording config_missing', {
      detail,
    })
    await recordProbeRun(pool, {
      probeName: PROBE_NAMES.CONFLICT_UNRESOLVED,
      alertAudience: 'operator',
      verdictKind: VERDICT_KINDS.CONFIG_MISSING,
      recipientKind: RECIPIENT_KINDS.TELEGRAM,
      recipientEmail: TELEGRAM_ALERT_CHAT_ID || null,
      fingerprint,
      stats: enrichedStats,
      errorMessage: detail,
    })
    return false
  }
  const tgResult = await sendTelegramMessage({
    botToken: TELEGRAM_BOT_TOKEN,
    chatId: TELEGRAM_ALERT_CHAT_ID,
    text: telegramBody,
    retryMax,
  })
  if (tgResult.ok) {
    logJson('info', 'Telegram alert sent', {
      chatId: TELEGRAM_ALERT_CHAT_ID,
      messageId: tgResult.messageId,
    })
    await recordProbeRun(pool, {
      probeName: PROBE_NAMES.CONFLICT_UNRESOLVED,
      alertAudience: 'operator',
      verdictKind: VERDICT_KINDS.ALERT_SENT,
      alertSent: true,
      recipientKind: RECIPIENT_KINDS.TELEGRAM,
      recipientEmail: TELEGRAM_ALERT_CHAT_ID,
      alertEmailId: tgResult.messageId || null,
      fingerprint,
      stats: enrichedStats,
    })
    return true
  }
  const redactedDetail = redactTelegramSecret(
    tgResult.detail ?? tgResult.error,
    TELEGRAM_BOT_TOKEN,
  )
  logJson('warn', 'Telegram send failed', {
    error: tgResult.error,
    detail: redactedDetail,
  })
  await recordProbeRun(pool, {
    probeName: PROBE_NAMES.CONFLICT_UNRESOLVED,
    alertAudience: 'operator',
    verdictKind: VERDICT_KINDS.ALERT_SEND_FAILED,
    recipientKind: RECIPIENT_KINDS.TELEGRAM,
    recipientEmail: TELEGRAM_ALERT_CHAT_ID,
    fingerprint,
    stats: enrichedStats,
    errorMessage: redactedDetail || tgResult.error,
  })
  return false
}

// bcs-def-1-fanout impl — per-teacher fan-out branch (plan §0b+§0c+§0g).
// Runs ONLY when TEACHER_FANOUT_ENABLED=1 (env from systemd unit). Builds
// per-teacher groups from the unbounded qualifying set, dedups per-teacher
// using state.perTeacher[teacherId], applies cap-drain rotation by
// oldest lastAttemptAt first. Mutates `state.perTeacher` in place;
// caller persists once at the end. Returns { sent, deduped, deferred }.
async function runTeacherFanout({
  pool,
  allOffenders,
  thresholds,
  baseStats,
  state,
  now,
}) {
  if (allOffenders.length === 0) {
    return { sent: 0, deduped: 0, deferred: 0 }
  }
  const grouped = groupOffendersByTeacher(allOffenders)
  const teacherIds = Array.from(grouped.keys())

  const candidates = []
  const dedupSkipped = []
  for (const teacherId of teacherIds) {
    const group = grouped.get(teacherId)
    const fp = perTeacherFingerprint(group.slots)
    const prev = state.perTeacher[teacherId] ?? null
    const dedupActive =
      prev
      && prev.lastFingerprint === fp
      && prev.lastAlertAt
      && now - prev.lastAlertAt < TEACHER_DEDUP_WINDOW_MS
    if (dedupActive) {
      dedupSkipped.push({ teacherId, group, fp })
    } else {
      candidates.push({
        teacherId,
        group,
        fp,
        lastAttemptAt: prev?.lastAttemptAt ?? 0,
      })
    }
  }

  // Cap-drain rotation — oldest lastAttemptAt first (0 = never).
  candidates.sort((a, b) => a.lastAttemptAt - b.lastAttemptAt)
  const selected = candidates.slice(0, TEACHER_FANOUT_CAP)
  const deferred = candidates.slice(TEACHER_FANOUT_CAP)

  for (const { teacherId, group, fp } of dedupSkipped) {
    await recordProbeRun(pool, {
      probeName: PROBE_NAMES.CONFLICT_UNRESOLVED,
      alertAudience: 'teacher',
      verdictKind: VERDICT_KINDS.DEDUP_SKIP,
      recipientKind: RECIPIENT_KINDS.EMAIL,
      recipientEmail: group.teacherEmail,
      fingerprint: fp,
      stats: { ...baseStats, slotsForTeacher: group.slots.length },
    })
  }

  let sentCount = 0
  for (const { teacherId, group, fp } of selected) {
    let result
    if (!process.env.RESEND_API_KEY) {
      result = { ok: false, error: 'missing_resend_api_key' }
    } else {
      const { subject, text } = buildTeacherEmail(group, thresholds)
      const resend = new Resend(process.env.RESEND_API_KEY)
      try {
        const sent = await resend.emails.send({
          from: EMAIL_FROM,
          to: [group.teacherEmail],
          subject,
          text,
        })
        if (sent.error) {
          result = {
            ok: false,
            error: 'resend_send_failed',
            detail: String(sent.error),
          }
        } else {
          result = { ok: true, emailId: sent.data?.id ?? null }
        }
      } catch (err) {
        result = {
          ok: false,
          error: 'resend_send_failed',
          detail: err instanceof Error ? err.message : String(err),
        }
      }
    }
    if (result.ok) {
      state.perTeacher[teacherId] = {
        lastAlertAt: now,
        lastFingerprint: fp,
        lastAttemptAt: now,
      }
      sentCount += 1
      await recordProbeRun(pool, {
        probeName: PROBE_NAMES.CONFLICT_UNRESOLVED,
        alertAudience: 'teacher',
        verdictKind: VERDICT_KINDS.ALERT_SENT,
        alertSent: true,
        recipientKind: RECIPIENT_KINDS.EMAIL,
        recipientEmail: group.teacherEmail,
        alertEmailId: result.emailId,
        fingerprint: fp,
        stats: { ...baseStats, slotsForTeacher: group.slots.length },
      })
    } else {
      const prev = state.perTeacher[teacherId] ?? {}
      state.perTeacher[teacherId] = {
        lastAlertAt: prev.lastAlertAt ?? null,
        lastFingerprint: prev.lastFingerprint ?? null,
        lastAttemptAt: now,
      }
      const isConfigMissing = result.error === 'missing_resend_api_key'
      await recordProbeRun(pool, {
        probeName: PROBE_NAMES.CONFLICT_UNRESOLVED,
        alertAudience: 'teacher',
        verdictKind: isConfigMissing
          ? VERDICT_KINDS.CONFIG_MISSING
          : VERDICT_KINDS.ALERT_SEND_FAILED,
        recipientKind: RECIPIENT_KINDS.EMAIL,
        recipientEmail: group.teacherEmail,
        fingerprint: fp,
        stats: { ...baseStats, slotsForTeacher: group.slots.length },
        errorMessage: result.detail ?? result.error,
      })
    }
  }

  if (deferred.length > 0) {
    await recordProbeRun(pool, {
      probeName: PROBE_NAMES.CONFLICT_UNRESOLVED,
      alertAudience: 'teacher',
      verdictKind: VERDICT_KINDS.DEDUP_SKIP,
      recipientKind: RECIPIENT_KINDS.EMAIL,
      fingerprint: null,
      stats: {
        ...baseStats,
        defer_reason: 'cap_drain_rotation',
        deferred_count: deferred.length,
        cap: TEACHER_FANOUT_CAP,
      },
    })
  }

  return { sent: sentCount, deduped: dedupSkipped.length, deferred: deferred.length }
}

async function main() {
  if (!process.env.DATABASE_URL) {
    logJson('error', 'DATABASE_URL not set; aborting')
    process.exit(2)
  }

  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
    ssl: resolveSslConfig(process.env.DATABASE_URL),
  })

  // Declared up front so the catch + finally blocks can reference them
  // even if resolveOperatorSettingsForProbe() throws (re-paranoia
  // plan-round-2 WARN#3 closure 2026-05-19): the operator-settings
  // read was previously outside the outer try, so a transient DB hiccup
  // there bypassed both `recordProbeRun(error)` and `pool.end()`.
  let capturedThresholds = null
  let capturedThresholdsSource = null
  let recipientEmailSnapshot = ALERT_EMAIL_TO || null
  // BCS-DEF-1-TG (2026-05-19) — Telegram knobs declared up front so
  // the catch block can reference them too.
  let telegramEnabled = false
  let telegramRetryMax = 2

  try {
    // Snapshot read of operator settings at tick start (DB → env → default).
    // BCS-DEF-1-TG (2026-05-19): also resolve channel-scope Telegram
    // settings.
    const probeSettings = await resolveOperatorSettingsForProbe(
      pool,
      'conflict-unresolved',
    )
    const channelSettings = await resolveChannelSettings(pool, 'telegram')
    const settings = { ...probeSettings, ...channelSettings }
    THRESHOLD_MINUTES = settings.CONFLICT_UNRESOLVED_THRESHOLD_MINUTES.value
    REPORT_LIMIT = settings.CONFLICT_UNRESOLVED_REPORT_LIMIT.value
    PER_TEACHER_LIMIT = settings.CONFLICT_UNRESOLVED_PER_TEACHER_LIMIT.value
    DEDUP_WINDOW_MS = settings.CONFLICT_UNRESOLVED_DEDUP_WINDOW_MS.value
    telegramEnabled = settings.TELEGRAM_ALERTS_MASTER_SWITCH.value === 1
    telegramRetryMax = settings.TELEGRAM_ALERTS_RETRY_MAX.value

    capturedThresholds = {
      CONFLICT_UNRESOLVED_THRESHOLD_MINUTES: THRESHOLD_MINUTES,
      CONFLICT_UNRESOLVED_REPORT_LIMIT: REPORT_LIMIT,
      CONFLICT_UNRESOLVED_PER_TEACHER_LIMIT: PER_TEACHER_LIMIT,
      CONFLICT_UNRESOLVED_DEDUP_WINDOW_MS: DEDUP_WINDOW_MS,
    }
    capturedThresholdsSource = {
      CONFLICT_UNRESOLVED_THRESHOLD_MINUTES:
        settings.CONFLICT_UNRESOLVED_THRESHOLD_MINUTES.source,
      CONFLICT_UNRESOLVED_REPORT_LIMIT:
        settings.CONFLICT_UNRESOLVED_REPORT_LIMIT.source,
      CONFLICT_UNRESOLVED_PER_TEACHER_LIMIT:
        settings.CONFLICT_UNRESOLVED_PER_TEACHER_LIMIT.source,
      CONFLICT_UNRESOLVED_DEDUP_WINDOW_MS:
        settings.CONFLICT_UNRESOLVED_DEDUP_WINDOW_MS.source,
    }

    // Re-paranoia plan-round-1 WARN#4 closure (2026-05-19): the four
    // offender reads (counts, rows, per-teacher omitted, fingerprint
    // tuples) MUST share one snapshot so the email body, the "и ещё N"
    // tally, and the dedup fingerprint are internally consistent within
    // a single tick. A new row landing between read 1 and read 4 would
    // otherwise leave totals out of sync with the fingerprint and the
    // displayed slice.
    const snapshotClient = await pool.connect()
    let counts
    let offenders = []
    let perTeacherOmitted = new Map()
    let fingerprintTuples = []
    let allOffenders = []
    try {
      await snapshotClient.query('begin')
      await snapshotClient.query(
        'set transaction isolation level repeatable read read only',
      )
      counts = await readOffenderCounts(snapshotClient, THRESHOLD_MINUTES)
      if (counts.totalConflicts > 0) {
        offenders = await readOffenderRows(
          snapshotClient,
          THRESHOLD_MINUTES,
          PER_TEACHER_LIMIT,
          REPORT_LIMIT,
        )
        perTeacherOmitted = await readPerTeacherOmittedCounts(
          snapshotClient,
          THRESHOLD_MINUTES,
          PER_TEACHER_LIMIT,
        )
        // Wave-paranoia round-1 BLOCKER#2 closure (2026-05-19): fingerprint
        // over the UNBOUNDED qualifying set, not the truncated visible
        // slice. Inside the same snapshot so the dedup decision agrees
        // with the email body.
        fingerprintTuples = await readFingerprintTuples(
          snapshotClient,
          THRESHOLD_MINUTES,
        )
        // bcs-def-1-fanout impl — full per-teacher set for the fan-out
        // branch. Read INSIDE the same snapshot so per-teacher dedup
        // fingerprint agrees with the operator-side fingerprint and the
        // emailed slot set.
        if (TEACHER_FANOUT_ENABLED) {
          allOffenders = await readAllOffendersForFanout(
            snapshotClient,
            THRESHOLD_MINUTES,
          )
        }
      }
      await snapshotClient.query('commit')
    } catch (snapshotErr) {
      await snapshotClient.query('rollback').catch(() => {})
      throw snapshotErr
    } finally {
      snapshotClient.release()
    }

    // bcs-def-1-fanout impl — GC step BEFORE any early-return branch.
    // Walk state.perTeacher and prune any teacher_id no longer in the
    // qualifying set (resolved, role lost, account purged, etc.).
    // Persist unconditionally if mutated so the admin reader doesn't
    // show stale teacher entries.
    const state = await readState()
    const now = Date.now()
    const qualifyingTeacherIds = new Set(
      fingerprintTuples.map((t) => t.teacherAccountId),
    )
    let stateMutated = false
    for (const teacherId of Object.keys(state.perTeacher)) {
      if (!qualifyingTeacherIds.has(teacherId)) {
        delete state.perTeacher[teacherId]
        stateMutated = true
      }
    }
    if (stateMutated) {
      await writeState(state)
    }

    if (counts.totalConflicts === 0) {
      logJson('info', 'no offenders above threshold', {
        thresholdMinutes: THRESHOLD_MINUTES,
      })
      await recordProbeRun(pool, {
        probeName: PROBE_NAMES.CONFLICT_UNRESOLVED,
        alertAudience: 'operator',
        verdictKind: VERDICT_KINDS.NO_OFFENDERS,
        stats: {
          totalConflicts: 0,
          totalTeachers: 0,
          thresholds: capturedThresholds,
          thresholds_source: capturedThresholdsSource,
        },
      })
      return
    }

    const enrichedStats = {
      totalConflicts: counts.totalConflicts,
      totalTeachers: counts.totalTeachers,
      shown: offenders.length,
      thresholds: capturedThresholds,
      thresholds_source: capturedThresholdsSource,
    }

    const fp = fingerprint(fingerprintTuples)
    // bcs-def-1-fanout impl wave-paranoia R1 BLOCKER #1 closure
    // (2026-06-04): operator-level dedup MUST NOT short-circuit the
    // teacher fan-out branch. The two state machines are independent:
    // operator dedup_window = 4h (per-offender-set), teacher dedup
    // window = 12h (per-teacher-set). Earlier draft `return`-ed inside
    // the operator dedup branch, suppressing cap-drain rotation +
    // failed-teacher retries until operator's 4h window expired.
    // Re-shape: capture `operatorDedupActive` as a flag; skip the
    // operator email + telegram + email-state-write conditionally; let
    // execution fall through to the fan-out channel unconditionally.
    const operatorDedupActive = (
      state.lastFingerprint === fp
      && state.lastAlertAt != null
      && now - state.lastAlertAt < DEDUP_WINDOW_MS
    )

    if (operatorDedupActive) {
      logJson(
        'info',
        'offenders unchanged within dedup window; skipping operator email',
        { fingerprint: fp, windowMs: DEDUP_WINDOW_MS, shown: offenders.length },
      )
      // BCS-DEF-1-TG R2 WARN#2 closure (2026-05-19): dedup_skip emits
      // one row per channel — Telegram row only if master switch on.
      await recordProbeRun(pool, {
        probeName: PROBE_NAMES.CONFLICT_UNRESOLVED,
        alertAudience: 'operator',
        verdictKind: VERDICT_KINDS.DEDUP_SKIP,
        recipientKind: RECIPIENT_KINDS.EMAIL,
        fingerprint: fp,
        stats: enrichedStats,
      })
      if (telegramEnabled) {
        await recordProbeRun(pool, {
          probeName: PROBE_NAMES.CONFLICT_UNRESOLVED,
          alertAudience: 'operator',
          verdictKind: VERDICT_KINDS.DEDUP_SKIP,
          recipientKind: RECIPIENT_KINDS.TELEGRAM,
          fingerprint: fp,
          stats: enrichedStats,
        })
      }
    } else {
      // BCS-DEF-1-TG R1 BLOCKER#3 closure — gather-then-dispatch. Both
      // bodies built BEFORE entering channel dispatch; the REPEATABLE
      // READ snapshot block above already committed (R2 BLOCKER#2: stays
      // in main()). State file is EMAIL-controlled (RISK-3).
      const telegramBody = buildTelegramBody(counts)

      // CHANNEL 1 — email
      let emailOk = false
      try {
        const sendResult = await tryEmailChannel({
          offenders,
          counts,
          perTeacherOmitted,
        })
        if (sendResult.ok) {
          emailOk = true
          logJson('info', 'conflict-unresolved alert email sent', {
            shown: offenders.length,
            totalConflicts: counts.totalConflicts,
            totalTeachers: counts.totalTeachers,
            fingerprint: fp,
            emailId: sendResult.emailId,
          })
          await recordProbeRun(pool, {
            probeName: PROBE_NAMES.CONFLICT_UNRESOLVED,
            alertAudience: 'operator',
            verdictKind: VERDICT_KINDS.ALERT_SENT,
            alertSent: true,
            recipientKind: RECIPIENT_KINDS.EMAIL,
            recipientEmail: recipientEmailSnapshot,
            alertEmailId: sendResult.emailId,
            fingerprint: fp,
            stats: enrichedStats,
          })
        } else {
          const isConfigMissing =
            sendResult.error === 'missing_resend_api_key'
            || sendResult.error === 'missing_alert_email_to'
          if (isConfigMissing) {
            logJson(
              'warn',
              'alert would fire but email destination/key not set; state NOT advanced',
              { shown: offenders.length },
            )
          } else {
            logJson('warn', 'resend send failed; state NOT advanced', {
              error: sendResult.detail ?? sendResult.error,
            })
          }
          await recordProbeRun(pool, {
            probeName: PROBE_NAMES.CONFLICT_UNRESOLVED,
            alertAudience: 'operator',
            verdictKind: isConfigMissing
              ? VERDICT_KINDS.CONFIG_MISSING
              : VERDICT_KINDS.ALERT_SEND_FAILED,
            recipientKind: RECIPIENT_KINDS.EMAIL,
            recipientEmail: recipientEmailSnapshot,
            fingerprint: fp,
            stats: enrichedStats,
            errorMessage: sendResult.detail ?? sendResult.error,
          })
        }
      } catch (emailErr) {
        logJson('error', 'tryEmailChannel threw unexpectedly', {
          err: emailErr instanceof Error ? emailErr.message : String(emailErr),
        })
        await recordProbeRun(pool, {
          probeName: PROBE_NAMES.CONFLICT_UNRESOLVED,
          alertAudience: 'operator',
          verdictKind: VERDICT_KINDS.ALERT_SEND_FAILED,
          recipientKind: RECIPIENT_KINDS.EMAIL,
          recipientEmail: recipientEmailSnapshot,
          fingerprint: fp,
          stats: enrichedStats,
          errorMessage:
            emailErr instanceof Error ? emailErr.message : String(emailErr),
        })
      }

      if (emailOk) {
        state.lastAlertAt = now
        state.lastFingerprint = fp
        await writeState(state)
      }

      // CHANNEL 2 — Telegram, runs regardless of email outcome.
      if (telegramEnabled) {
        try {
          await tryTelegramChannel({
            pool,
            telegramBody,
            fingerprint: fp,
            enrichedStats,
            retryMax: telegramRetryMax,
          })
        } catch (tgErr) {
          const raw = stringifyTelegramError(tgErr)
          logJson('error', 'tryTelegramChannel threw unexpectedly', {
            err: redactTelegramSecret(raw, TELEGRAM_BOT_TOKEN),
          })
        }
      }
    }

    // CHANNEL 3 — per-teacher fan-out (default OFF). Gated by
    // TEACHER_FANOUT_ENABLED env. Runs UNCONDITIONALLY of operator
    // dedup (wave-paranoia R1 BLOCKER #1) so cap-drain rotation and
    // per-teacher retries progress even when the operator email is
    // dedup-skipped. Best-effort: a fan-out send failure does NOT
    // propagate or block the operator email outcome.
    if (TEACHER_FANOUT_ENABLED) {
      try {
        const summary = await runTeacherFanout({
          pool,
          allOffenders,
          thresholds: { thresholdMinutes: THRESHOLD_MINUTES },
          baseStats: {
            ...enrichedStats,
            fingerprint_op: fp,
          },
          state,
          now,
        })
        logJson('info', 'teacher fan-out complete', summary)
        await writeState(state)
      } catch (fanoutErr) {
        logJson('error', 'runTeacherFanout threw unexpectedly', {
          err: fanoutErr instanceof Error ? fanoutErr.message : String(fanoutErr),
        })
        // Persist whatever partial state mutated before the throw so
        // cap-rotation progresses across the partial set.
        try {
          await writeState(state)
        } catch (writeErr) {
          logJson('error', 'writeState after fan-out throw failed', {
            err: writeErr instanceof Error ? writeErr.message : String(writeErr),
          })
        }
      }
    }
  } catch (err) {
    await recordProbeRun(pool, {
      probeName: PROBE_NAMES.CONFLICT_UNRESOLVED,
      alertAudience: 'operator',
      verdictKind: VERDICT_KINDS.ERROR,
      errorMessage: err instanceof Error ? err.message : String(err),
      stats: {
        thresholds: capturedThresholds,
        thresholds_source: capturedThresholdsSource,
      },
    })
    throw err
  } finally {
    await pool.end()
  }
}

const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith('conflict-unresolved-alert.mjs')

if (invokedDirectly) {
  main().catch((err) => {
    logJson('error', 'conflict-unresolved-alert crashed', {
      message: err instanceof Error ? err.message : String(err),
    })
    process.exit(1)
  })
}
