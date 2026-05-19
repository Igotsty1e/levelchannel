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
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve as resolvePath } from 'node:path'

import pg from 'pg'
import { Resend } from 'resend'

import { resolveSslConfig } from './_pg-ssl.mjs'
import { resolveOperatorSettingsForProbe } from './lib/operator-settings.mjs'
import { recordProbeRun, PROBE_NAMES, VERDICT_KINDS } from './lib/probe-runs.mjs'

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

const STATE_FILE = process.env.CONFLICT_UNRESOLVED_STATE_FILE
  ? resolvePath(process.env.CONFLICT_UNRESOLVED_STATE_FILE)
  : resolvePath('./var/conflict-unresolved-state.json')

const ALERT_EMAIL_TO = process.env.ALERT_EMAIL_TO?.trim() || ''
const EMAIL_FROM =
  process.env.EMAIL_FROM?.trim() || 'LevelChannel <noreply@example.com>'
const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.trim() || 'https://levelchannel.ru'

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

function pluralRu(n, one, few, many) {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few
  return many
}

function formatHours(minutes) {
  if (minutes < 60) return `${minutes} мин`
  if (minutes % 60 === 0) return `${minutes / 60} ч`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${h}ч ${m}мин`
}

// --- State file --------------------------------------------------------

async function readState() {
  try {
    const raw = await readFile(STATE_FILE, 'utf8')
    return JSON.parse(raw)
  } catch {
    return { lastAlertAt: null, lastFingerprint: null }
  }
}

async function writeState(state) {
  await mkdir(dirname(STATE_FILE), { recursive: true })
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2), 'utf8')
}

// --- Main --------------------------------------------------------------

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

  // Snapshot read of operator settings at tick start (DB → env → default).
  const settings = await resolveOperatorSettingsForProbe(
    pool,
    'conflict-unresolved',
  )
  THRESHOLD_MINUTES = settings.CONFLICT_UNRESOLVED_THRESHOLD_MINUTES.value
  REPORT_LIMIT = settings.CONFLICT_UNRESOLVED_REPORT_LIMIT.value
  PER_TEACHER_LIMIT = settings.CONFLICT_UNRESOLVED_PER_TEACHER_LIMIT.value
  DEDUP_WINDOW_MS = settings.CONFLICT_UNRESOLVED_DEDUP_WINDOW_MS.value

  const capturedThresholds = {
    CONFLICT_UNRESOLVED_THRESHOLD_MINUTES: THRESHOLD_MINUTES,
    CONFLICT_UNRESOLVED_REPORT_LIMIT: REPORT_LIMIT,
    CONFLICT_UNRESOLVED_PER_TEACHER_LIMIT: PER_TEACHER_LIMIT,
    CONFLICT_UNRESOLVED_DEDUP_WINDOW_MS: DEDUP_WINDOW_MS,
  }
  const capturedThresholdsSource = {
    CONFLICT_UNRESOLVED_THRESHOLD_MINUTES:
      settings.CONFLICT_UNRESOLVED_THRESHOLD_MINUTES.source,
    CONFLICT_UNRESOLVED_REPORT_LIMIT:
      settings.CONFLICT_UNRESOLVED_REPORT_LIMIT.source,
    CONFLICT_UNRESOLVED_PER_TEACHER_LIMIT:
      settings.CONFLICT_UNRESOLVED_PER_TEACHER_LIMIT.source,
    CONFLICT_UNRESOLVED_DEDUP_WINDOW_MS:
      settings.CONFLICT_UNRESOLVED_DEDUP_WINDOW_MS.source,
  }
  const recipientEmailSnapshot = ALERT_EMAIL_TO || null

  try {
    const counts = await readOffenderCounts(pool, THRESHOLD_MINUTES)
    if (counts.totalConflicts === 0) {
      logJson('info', 'no offenders above threshold', {
        thresholdMinutes: THRESHOLD_MINUTES,
      })
      await recordProbeRun(pool, {
        probeName: PROBE_NAMES.CONFLICT_UNRESOLVED,
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

    const offenders = await readOffenderRows(
      pool,
      THRESHOLD_MINUTES,
      PER_TEACHER_LIMIT,
      REPORT_LIMIT,
    )
    const perTeacherOmitted = await readPerTeacherOmittedCounts(
      pool,
      THRESHOLD_MINUTES,
      PER_TEACHER_LIMIT,
    )

    const enrichedStats = {
      totalConflicts: counts.totalConflicts,
      totalTeachers: counts.totalTeachers,
      shown: offenders.length,
      thresholds: capturedThresholds,
      thresholds_source: capturedThresholdsSource,
    }

    const fp = fingerprint(offenders)
    const state = await readState()
    const now = Date.now()
    if (
      state.lastFingerprint === fp
      && state.lastAlertAt
      && now - state.lastAlertAt < DEDUP_WINDOW_MS
    ) {
      logJson(
        'info',
        'offenders unchanged within dedup window; skipping email',
        { fingerprint: fp, windowMs: DEDUP_WINDOW_MS, shown: offenders.length },
      )
      await recordProbeRun(pool, {
        probeName: PROBE_NAMES.CONFLICT_UNRESOLVED,
        verdictKind: VERDICT_KINDS.DEDUP_SKIP,
        fingerprint: fp,
        stats: enrichedStats,
      })
      return
    }

    const { subject, text } = buildEmail(offenders, counts, perTeacherOmitted)
    if (!ALERT_EMAIL_TO || !process.env.RESEND_API_KEY) {
      logJson(
        'warn',
        'alert would fire but email destination/key not set; state NOT advanced',
        { shown: offenders.length },
      )
      await recordProbeRun(pool, {
        probeName: PROBE_NAMES.CONFLICT_UNRESOLVED,
        verdictKind: VERDICT_KINDS.CONFIG_MISSING,
        recipientEmail: recipientEmailSnapshot,
        fingerprint: fp,
        stats: enrichedStats,
        errorMessage: !ALERT_EMAIL_TO
          ? 'missing_alert_email_to'
          : 'missing_resend_api_key',
      })
      return
    }

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
        transportErr instanceof Error
          ? transportErr.message
          : String(transportErr)
      logJson('warn', 'resend send threw; state NOT advanced', {
        error: detail,
      })
      await recordProbeRun(pool, {
        probeName: PROBE_NAMES.CONFLICT_UNRESOLVED,
        verdictKind: VERDICT_KINDS.ALERT_SEND_FAILED,
        recipientEmail: recipientEmailSnapshot,
        fingerprint: fp,
        stats: enrichedStats,
        errorMessage: detail,
      })
      return
    }
    if (sent.error) {
      logJson('warn', 'resend email failed; state NOT advanced', {
        error: String(sent.error),
      })
      await recordProbeRun(pool, {
        probeName: PROBE_NAMES.CONFLICT_UNRESOLVED,
        verdictKind: VERDICT_KINDS.ALERT_SEND_FAILED,
        recipientEmail: recipientEmailSnapshot,
        fingerprint: fp,
        stats: enrichedStats,
        errorMessage: String(sent.error),
      })
      return
    }

    logJson('info', 'conflict-unresolved alert email sent', {
      shown: offenders.length,
      totalConflicts: counts.totalConflicts,
      totalTeachers: counts.totalTeachers,
      fingerprint: fp,
      emailId: sent.data?.id ?? null,
    })
    await writeState({ lastAlertAt: now, lastFingerprint: fp })
    await recordProbeRun(pool, {
      probeName: PROBE_NAMES.CONFLICT_UNRESOLVED,
      verdictKind: VERDICT_KINDS.ALERT_SENT,
      alertSent: true,
      recipientEmail: recipientEmailSnapshot,
      alertEmailId: sent.data?.id ?? null,
      fingerprint: fp,
      stats: enrichedStats,
    })
  } catch (err) {
    await recordProbeRun(pool, {
      probeName: PROBE_NAMES.CONFLICT_UNRESOLVED,
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
