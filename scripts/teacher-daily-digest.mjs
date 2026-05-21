#!/usr/bin/env node
//
// BCS-DEF-5 (2026-05-19) — daily 08:00 teacher lesson digest cron.
//
// Plan: docs/plans/bcs-def-5-teacher-reminders.md (§0a-§0e binding).
//
// Fires once per minute. For each teacher whose local clock at tick
// time is in `[07:59:00, 08:01:00]`, send a digest email listing every
// `booked` slot whose `start_at` falls on the teacher's local
// calendar day. ONE email per (teacher, sent_date) — idempotent via
// `teacher_account_daily_digests` PK.
//
// Operator-tunable thresholds (DB → env → default), per
// lib/admin/operator-settings.ts SETTING_SCHEMA + scripts/lib/
// operator-settings.mjs mirror:
//
//   TEACHER_DIGEST_MASTER_SWITCH         default 0   min:0 max:1
//   TEACHER_DIGEST_RATE_LIMIT_PER_TICK   default 200 min:1 max:5000
//   TEACHER_DIGEST_MAX_ATTEMPTS          default 3   min:1 max:10
//
// Other env:
//   DATABASE_URL          — postgres connection
//   RESEND_API_KEY        — Resend SDK key (else digest send fails)
//   EMAIL_FROM            — sender (reused from main app)
//   NEXT_PUBLIC_SITE_URL  — used to build /teacher CTA link
//
// Failure mode + idempotence:
//   - PG outage → throw → systemd captures non-zero, no send
//   - Resend outage → row last_error updated; next tick within band
//     retries (attempts increments)
//   - After max_attempts retries → skipped_reason='send_failed' (terminal)
//
// Module shape: helpers are NAMED EXPORTS so integration tests can
// import them without invoking `main()`. The `if (invokedDirectly) {
// main() }` guard at the bottom matches the auth-flow / conflict-
// unresolved pattern.

import pg from 'pg'
import { Resend } from 'resend'

import { resolveSslConfig } from './_pg-ssl.mjs'
import { resolveOperatorSettingsForProbe } from './lib/operator-settings.mjs'
import {
  recordProbeRun,
  PROBE_NAMES,
  VERDICT_KINDS,
} from './lib/probe-runs.mjs'
import { renderTeacherDailyDigestEmail } from './lib/teacher-daily-digest-template.mjs'
import { renderTeacherDailyDigestTelegram } from './lib/teacher-daily-digest-telegram-template.mjs'
import { runTeacherTelegramBlock } from './lib/teacher-daily-digest-telegram.mjs'
import { sendTelegramMessage } from './lib/telegram-alerts.mjs'
import { safeTimezone } from './lib/timezone.mjs'

const EMAIL_FROM =
  process.env.EMAIL_FROM?.trim() || 'LevelChannel <noreply@example.com>'
const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.trim() || 'https://levelchannel.ru'

// Firing band — ±60 seconds around teacher's local 08:00 wall clock
// (Round-3 BLOCKER 5 closure: drop Persistent= claim; OnCalendar=
// *-*-* *:*:00 in the timer unit gives calendar-aligned ticks).
// Inclusive both ends.
const FIRING_BAND_START_HHMMSS = '07:59:00'
const FIRING_BAND_END_HHMMSS = '08:01:00'

// Wide candidate-set window so morning-already-passed slots in
// positive-UTC zones are still included (R2-BLOCKER 2 closure).
const CANDIDATE_WINDOW_PAST_HOURS = 24
const CANDIDATE_WINDOW_FUTURE_HOURS = 36

// Overfetch buffer on the candidate-set LIMIT — covers tick-skips
// (outside_band teachers consume no rate-limit budget but DO count
// against the LIMIT). 64 leaves headroom for a typical morning band.
const CANDIDATE_OVERFETCH_BUFFER = 64

function logJson(level, msg, extra = {}) {
  console.log(
    JSON.stringify({
      level,
      ts: new Date().toISOString(),
      probe: 'teacher-daily-digest',
      msg,
      ...extra,
    }),
  )
}

// --- Time-zone helpers (exported for unit tests) ---------------------

/**
 * Compute the teacher's wall-clock parts at `now` in the given IANA
 * timezone. Returns `{ ymd: 'YYYY-MM-DD', hms: 'HH:MM:SS' }` in 24h.
 */
export function nowInTimezoneParts(now, tz) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  const parts = fmt.formatToParts(now)
  const get = (type) => parts.find((p) => p.type === type)?.value ?? '00'
  // Intl on some platforms returns hour='24' for midnight — normalize.
  const rawHh = get('hour')
  const hh = rawHh === '24' ? '00' : rawHh
  const ymd = `${get('year')}-${get('month')}-${get('day')}`
  const hms = `${hh}:${get('minute')}:${get('second')}`
  return { ymd, hms }
}

/**
 * @param {string} hms 'HH:MM:SS'
 * @returns true if hms is within the inclusive firing-band [07:59:00, 08:01:00].
 */
export function isWithinFiringBand(hms) {
  return hms >= FIRING_BAND_START_HHMMSS && hms <= FIRING_BAND_END_HHMMSS
}

// --- DB readers (exported for tests) ---------------------------------

/**
 * Candidate-set query (§2.2 step 3). Returns teachers with at least
 * one booked slot in a 60h band centered on now() who do NOT yet have
 * a terminal dedup row for their local today.
 *
 * @param {import('pg').Pool | import('pg').PoolClient} db
 * @param {number} maxAttempts  TEACHER_DIGEST_MAX_ATTEMPTS
 * @param {number} rateLimit    TEACHER_DIGEST_RATE_LIMIT_PER_TICK
 */
export async function selectCandidateTeachers(db, maxAttempts, rateLimit) {
  const r = await db.query(
    `with current_teachers as (
       select distinct s.teacher_account_id as account_id
         from lesson_slots s
        where s.status = 'booked'
          and s.start_at >= now() - ($1::int || ' hours')::interval
          and s.start_at <  now() + ($2::int || ' hours')::interval
     )
     select a.id            as account_id,
            a.email         as account_email,
            coalesce(p.timezone, 'Europe/Moscow') as raw_tz,
            p.display_name  as display_name,
            (now() AT TIME ZONE coalesce(p.timezone, 'Europe/Moscow'))::date
              as their_today_local
       from current_teachers ct
       join accounts a              on a.id = ct.account_id
       left join account_profiles p on p.account_id = a.id
       left join teacher_account_daily_digests tadd
         on tadd.account_id = a.id
        and tadd.sent_date =
            (now() AT TIME ZONE coalesce(p.timezone, 'Europe/Moscow'))::date
      where a.disabled_at is null
        and a.scheduled_purge_at is null
        and a.purged_at is null
        and (
          tadd.account_id is null
          or (
            tadd.email_sent = false
            and tadd.skipped_reason is null
            and tadd.attempts < $3::int
          )
        )
      order by a.id
      limit $4::int`,
    [
      CANDIDATE_WINDOW_PAST_HOURS,
      CANDIDATE_WINDOW_FUTURE_HOURS,
      maxAttempts,
      rateLimit + CANDIDATE_OVERFETCH_BUFFER,
    ],
  )
  return r.rows.map((row) => ({
    accountId: String(row.account_id),
    accountEmail: row.account_email ? String(row.account_email) : '',
    rawTz: String(row.raw_tz),
    displayName: row.display_name ? String(row.display_name) : null,
    theirTodayLocal: new Date(String(row.their_today_local))
      .toISOString()
      .slice(0, 10),
  }))
}

/**
 * Per-teacher booked-slots query for the teacher's local calendar day
 * (§1.3). Inclusive of morning-already-passed slots (R3-BLOCKER 4).
 *
 * @param {import('pg').Pool | import('pg').PoolClient} db
 * @param {string} teacherAccountId
 * @param {string} todayLocalYmd  'YYYY-MM-DD'
 * @param {string} tz             validated IANA name
 */
export async function selectTeacherSlotsForLocalDay(
  db,
  teacherAccountId,
  todayLocalYmd,
  tz,
) {
  const r = await db.query(
    `select s.id, s.start_at, s.duration_minutes, s.learner_account_id, s.zoom_url
       from lesson_slots s
      where s.teacher_account_id = $1
        and s.status = 'booked'
        and s.start_at >= (($2::date)::timestamp AT TIME ZONE $3)
        and s.start_at <  (($2::date + 1)::timestamp AT TIME ZONE $3)
      order by s.start_at asc`,
    [teacherAccountId, todayLocalYmd, tz],
  )
  return r.rows.map((row) => ({
    slotId: String(row.id),
    startAtIso: new Date(String(row.start_at)).toISOString(),
    durationMinutes: Number(row.duration_minutes),
    learnerAccountId: row.learner_account_id
      ? String(row.learner_account_id)
      : null,
    zoomUrl: row.zoom_url ? String(row.zoom_url) : null,
  }))
}

/**
 * Batched learner-name lookup for the slot list (§1.3 second query).
 *
 * @param {import('pg').Pool | import('pg').PoolClient} db
 * @param {string[]} learnerAccountIds
 * @returns {Promise<Map<string, { email: string, displayName: string | null }>>}
 */
export async function loadLearnerLabels(db, learnerAccountIds) {
  const result = new Map()
  if (learnerAccountIds.length === 0) return result
  const r = await db.query(
    `select a.id, a.email, p.display_name
       from accounts a
       left join account_profiles p on p.account_id = a.id
      where a.id = any($1::uuid[])`,
    [learnerAccountIds],
  )
  for (const row of r.rows) {
    result.set(String(row.id), {
      email: String(row.email || ''),
      displayName: row.display_name ? String(row.display_name) : null,
    })
  }
  return result
}

// --- Per-teacher processing ------------------------------------------

/**
 * Process a single candidate teacher inside its own BEGIN/COMMIT. The
 * `resendSend` function is dependency-injected so tests can stub it
 * without spinning up an HTTP server. In production it wraps
 * `resend.emails.send(...)`.
 *
 * Returns one of:
 *   { outcome: 'outside_band' }
 *   { outcome: 'already_sent' }
 *   { outcome: 'terminal_skip' }
 *   { outcome: 'terminal_send_failed' }
 *   { outcome: 'empty_day' }
 *   { outcome: 'email_missing' }
 *   { outcome: 'sent', emailId: string | null }
 *   { outcome: 'send_failed_transient', message: string }
 *
 * @param {{
 *   pool: import('pg').Pool,
 *   candidate: ReturnType<typeof selectCandidateTeachers> extends Promise<infer R> ? R[number] : never,
 *   now: Date,
 *   maxAttempts: number,
 *   resendSend: (params: { from: string, to: string[], subject: string, text: string, html: string, idempotencyKey: string }) => Promise<{ ok: true, emailId: string | null } | { ok: false, message: string }>,
 * }} input
 */
export async function processOneTeacher({
  pool,
  candidate,
  now,
  maxAttempts,
  resendSend,
  // BCS-DEF-5-TG (2026-05-21) — Telegram block on the email-sent
  // branch only. Defaults preserve backward-compat (tests omitting
  // these args get the no-Telegram path).
  telegramEnabled = false,
  tgToken = '',
  tgSend = sendTelegramMessage,
  renderTelegram = renderTeacherDailyDigestTelegram,
}) {
  const tz = safeTimezone(candidate.rawTz)
  const { ymd, hms } = nowInTimezoneParts(now, tz)
  if (!isWithinFiringBand(hms)) {
    return { outcome: 'outside_band' }
  }

  const client = await pool.connect()
  let acquired = false
  try {
    await client.query('begin')
    acquired = true

    // Step e — Read existing dedup row with FOR UPDATE row lock.
    const existing = await client.query(
      `select email_sent, skipped_reason, attempts
         from teacher_account_daily_digests
        where account_id = $1 and sent_date = $2::date
        for update`,
      [candidate.accountId, ymd],
    )

    const existingRow = existing.rows[0] ?? null
    let proceedToSend = false
    let isRetryPath = false

    if (existingRow) {
      const emailSent = Boolean(existingRow.email_sent)
      const skippedReason =
        existingRow.skipped_reason === null ? null : String(existingRow.skipped_reason)
      const attempts = Number(existingRow.attempts)

      if (emailSent) {
        // e.i Terminal — already sent.
        await client.query('rollback')
        return { outcome: 'already_sent' }
      }
      if (skippedReason !== null) {
        // e.ii Terminal — any skipped_reason is terminal.
        await client.query('rollback')
        return { outcome: 'terminal_skip' }
      }
      if (attempts >= maxAttempts) {
        // e.iii Mark terminal send_failed (attempts exhausted).
        await client.query(
          `update teacher_account_daily_digests
              set skipped_reason='send_failed', updated_at=now()
            where account_id=$1 and sent_date=$2::date`,
          [candidate.accountId, ymd],
        )
        await client.query('commit')
        return { outcome: 'terminal_send_failed' }
      }
      // e.iv Retry-eligible row — fall through to send.
      isRetryPath = true
      proceedToSend = true
    } else {
      // e.v — no row yet. We'll INSERT inside step f.iii (after fetching
      // the slot list so we can branch on empty vs non-empty).
      proceedToSend = true
    }

    if (!proceedToSend) {
      // Should not reach here, but defensive.
      await client.query('rollback')
      return { outcome: 'terminal_skip' }
    }

    // Step f — Fetch slot list for teacher's local day.
    const slots = await selectTeacherSlotsForLocalDay(
      client,
      candidate.accountId,
      ymd,
      tz,
    )

    // Step f.i — Empty-day branch.
    if (slots.length === 0) {
      if (isRetryPath) {
        // Retry row already exists but no slots today — flip to empty_day
        // terminal (rare: a teacher who had slots earlier and cancelled
        // them after the first failed send).
        await client.query(
          `update teacher_account_daily_digests
              set skipped_reason='empty_day', updated_at=now()
            where account_id=$1 and sent_date=$2::date`,
          [candidate.accountId, ymd],
        )
      } else {
        await client.query(
          `insert into teacher_account_daily_digests
             (account_id, sent_date, email_sent, skipped_reason)
             values ($1, $2::date, false, 'empty_day')
             on conflict (account_id, sent_date) do nothing`,
          [candidate.accountId, ymd],
        )
      }
      await client.query('commit')
      return { outcome: 'empty_day' }
    }

    // Step f.ii — account_email_missing branch.
    if (!candidate.accountEmail || candidate.accountEmail.trim().length === 0) {
      if (isRetryPath) {
        await client.query(
          `update teacher_account_daily_digests
              set skipped_reason='account_email_missing', updated_at=now()
            where account_id=$1 and sent_date=$2::date`,
          [candidate.accountId, ymd],
        )
      } else {
        await client.query(
          `insert into teacher_account_daily_digests
             (account_id, sent_date, email_sent, skipped_reason)
             values ($1, $2::date, false, 'account_email_missing')
             on conflict (account_id, sent_date) do nothing`,
          [candidate.accountId, ymd],
        )
      }
      await client.query('commit')
      return { outcome: 'email_missing' }
    }

    // Step f.iii / retry — secure the dedup row (winner / loser race).
    if (!isRetryPath) {
      // First-attempt: INSERT ... ON CONFLICT DO NOTHING RETURNING.
      // Plan §0d R2-BLOCKER 3 closure — explicit detect-the-race
      // primitive. The state-machine CHECK constraint allows
      // `attempts=1` here because email_sent=false + skipped_reason=NULL
      // + attempts>=0 falls into the "pending" branch (Round-3 WARN 2
      // closure: send_failed terminal requires attempts >= 1, NOT a
      // generic >=1 floor on pending rows).
      const inserted = await client.query(
        `insert into teacher_account_daily_digests
           (account_id, sent_date, email_sent, skipped_reason, attempts)
           values ($1, $2::date, false, null, 1)
           on conflict (account_id, sent_date) do nothing
           returning attempts`,
        [candidate.accountId, ymd],
      )
      if (inserted.rows.length === 0) {
        // Lost the race — the OTHER tick won. Re-read row state and
        // branch. This is the loser path; the next tick will re-evaluate
        // cleanly via the candidate-set LEFT JOIN.
        await client.query('rollback')
        return { outcome: 'terminal_skip' }
      }
    } else {
      // Retry path — increment attempts BEFORE sending, guarded against
      // concurrent state change. The state-machine CHECK still holds
      // because `attempts < maxAttempts` was verified at step e.iv.
      const bumped = await client.query(
        `update teacher_account_daily_digests
            set attempts = attempts + 1, updated_at = now()
          where account_id = $1 and sent_date = $2::date
            and email_sent = false
            and skipped_reason is null
            and attempts < $3::int
          returning attempts`,
        [candidate.accountId, ymd, maxAttempts],
      )
      if (bumped.rows.length === 0) {
        // State changed under us — abandon.
        await client.query('rollback')
        return { outcome: 'terminal_skip' }
      }
    }

    // Step g — fetch learner labels for the slot list.
    const learnerAccountIds = slots
      .map((s) => s.learnerAccountId)
      .filter((id) => id !== null)
    const learnerLabels = await loadLearnerLabels(client, learnerAccountIds)

    // Step h — render email. The normalized-slot array is hoisted into
    // a local so the Telegram block (§2.4.2 Change A) can pass the SAME
    // shape into the Telegram renderer (R3 WARN #2 closure).
    const normalizedSlots = slots.map((s) => {
      const learner = s.learnerAccountId
        ? learnerLabels.get(s.learnerAccountId) ?? null
        : null
      return {
        startAtIso: s.startAtIso,
        learnerDisplayName: learner?.displayName ?? null,
        learnerEmail: learner?.email ?? '',
        zoomUrl: s.zoomUrl,
      }
    })
    const rendered = renderTeacherDailyDigestEmail({
      teacherDisplayName: candidate.displayName,
      teacherTimezone: tz,
      slots: normalizedSlots,
      siteUrl: SITE_URL,
    })

    // Step i — Resend send. Commit BEFORE sending would expose the
    // (slot,date) row globally; commit AFTER means a process kill mid-
    // send loses the increment but the next tick re-tries within
    // max_attempts. We commit AFTER so success/failure paths both
    // produce one COMMIT (no torn state).
    const sendResult = await resendSend({
      from: EMAIL_FROM,
      to: [candidate.accountEmail],
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
      idempotencyKey: `digest:${candidate.accountId}:${ymd}`,
    })

    if (sendResult.ok) {
      await client.query(
        `update teacher_account_daily_digests
            set email_sent=true,
                sent_at=now(),
                resend_email_id=$3,
                last_error=null,
                updated_at=now()
          where account_id=$1 and sent_date=$2::date`,
        [candidate.accountId, ymd, sendResult.emailId],
      )
      await client.query('commit')

      // BCS-DEF-5-TG (2026-05-21) — Telegram block on the email-sent
      // branch only. Email already durably persisted; best-effort
      // second-channel delivery. Failures here NEVER unwind the email.
      let telegramOutcome = null
      if (telegramEnabled && tgToken) {
        try {
          const tgBody = renderTelegram({
            slots: normalizedSlots,
            teacherDisplayName: candidate.displayName,
            teacherTimezone: tz,
            siteUrl: SITE_URL,
          })
          const tgResult = await runTeacherTelegramBlock({
            client,
            accountId: candidate.accountId,
            ymd,
            telegramEnabled: true,
            tgToken,
            tgSend,
            body: tgBody,
          })
          telegramOutcome = tgResult.tg
        } catch (tgErr) {
          telegramOutcome = 'terminal_send_failed'
          logJson('warn', 'telegram render/dispatch crashed', {
            accountId: candidate.accountId,
            ymd,
            err: tgErr instanceof Error ? tgErr.message : String(tgErr),
          })
          // BCS-DEF-5-TG-WAVE-PARANOIA round-1 BLOCKER 1 closure:
          // outer-wrapper crash (e.g. renderer throws BEFORE the
          // helper opens its own TX) MUST also persist terminal
          // state so the dedup row doesn't stay pending forever.
          // Opens a fresh TX on the same client (the email TX-A
          // already committed).
          try {
            await client.query('begin')
            await client.query(
              `update teacher_account_daily_digests
                  set telegram_skipped_reason = 'send_failed',
                      telegram_last_error = $3,
                      telegram_attempts = greatest(telegram_attempts, 1)
                where account_id = $1 and sent_date = $2::date
                  and telegram_sent = false
                  and telegram_skipped_reason is null`,
              [
                candidate.accountId,
                ymd,
                `outer_wrapper_crashed: ${
                  tgErr instanceof Error
                    ? tgErr.message.slice(0, 800)
                    : String(tgErr).slice(0, 800)
                }`,
              ],
            )
            await client.query('commit')
          } catch (recoveryErr) {
            try {
              await client.query('rollback')
            } catch {
              /* swallow */
            }
            logJson(
              'error',
              'outer-wrapper recovery write itself failed',
              {
                accountId: candidate.accountId,
                ymd,
                err: recoveryErr instanceof Error ? recoveryErr.message : String(recoveryErr),
              },
            )
          }
        }
      }

      return {
        outcome: 'sent',
        emailId: sendResult.emailId,
        telegramOutcome,
      }
    }

    // Transient failure — keep row in pending state (attempts already
    // incremented by step f.iii / retry), record last_error.
    await client.query(
      `update teacher_account_daily_digests
          set last_error=$3, updated_at=now()
        where account_id=$1 and sent_date=$2::date`,
      [candidate.accountId, ymd, sendResult.message.slice(0, 1000)],
    )
    await client.query('commit')
    return { outcome: 'send_failed_transient', message: sendResult.message }
  } catch (err) {
    if (acquired) {
      try {
        await client.query('rollback')
      } catch {
        /* swallow rollback errors */
      }
    }
    throw err
  } finally {
    client.release()
  }
}

// --- Main tick -------------------------------------------------------

async function main() {
  if (!process.env.DATABASE_URL) {
    logJson('error', 'DATABASE_URL not set; aborting')
    process.exit(2)
  }

  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 4,
    ssl: resolveSslConfig(process.env.DATABASE_URL),
  })

  let resolvedThresholds = null

  try {
    // Step 1 — operator settings snapshot.
    const settings = await resolveOperatorSettingsForProbe(
      pool,
      'teacher-daily-digest',
    )
    const masterSwitch = settings.TEACHER_DIGEST_MASTER_SWITCH.value === 1
    const rateLimit = settings.TEACHER_DIGEST_RATE_LIMIT_PER_TICK.value
    const maxAttempts = settings.TEACHER_DIGEST_MAX_ATTEMPTS.value
    // BCS-DEF-5-TG (2026-05-21) — Telegram channel master switch
    // (default 0, OFF). Independent of TEACHER_DIGEST_MASTER_SWITCH —
    // operator can run email-only by leaving this at 0.
    const telegramEnabled =
      settings.TEACHER_DIGEST_TELEGRAM_ENABLED?.value === 1
    const tgToken = (process.env.TELEGRAM_BOT_TOKEN ?? '').trim()

    resolvedThresholds = {
      TEACHER_DIGEST_MASTER_SWITCH:
        settings.TEACHER_DIGEST_MASTER_SWITCH.value,
      TEACHER_DIGEST_RATE_LIMIT_PER_TICK: rateLimit,
      TEACHER_DIGEST_MAX_ATTEMPTS: maxAttempts,
      TEACHER_DIGEST_TELEGRAM_ENABLED:
        settings.TEACHER_DIGEST_TELEGRAM_ENABLED?.value ?? 0,
    }

    // Step 2 — master switch gate.
    if (!masterSwitch) {
      logJson('info', 'master switch off; skipping tick', {
        thresholds: resolvedThresholds,
      })
      await recordProbeRun(pool, {
        probeName: PROBE_NAMES.TEACHER_DAILY_DIGEST,
        verdictKind: VERDICT_KINDS.DIGEST_SKIPPED_DISABLED,
        stats: { thresholds: resolvedThresholds },
      })
      return
    }

    // Step 3 — candidate-set query.
    const candidates = await selectCandidateTeachers(pool, maxAttempts, rateLimit)

    if (candidates.length === 0) {
      logJson('info', 'no candidate teachers', {
        thresholds: resolvedThresholds,
      })
      await recordProbeRun(pool, {
        probeName: PROBE_NAMES.TEACHER_DAILY_DIGEST,
        verdictKind: VERDICT_KINDS.DIGEST_NO_TEACHERS,
        stats: { thresholds: resolvedThresholds },
      })
      return
    }

    // Step 4 — per-row loop bounded by rateLimit.
    const counts = {
      teachers_evaluated: 0,
      outside_band: 0,
      already_sent: 0,
      terminal_skip: 0,
      terminal_send_failed: 0,
      empty_day: 0,
      email_missing: 0,
      sent: 0,
      send_failed_transient: 0,
      // BCS-DEF-5-TG (2026-05-21) — Telegram channel outcome counters.
      // Each maps 1:1 to a `tg:` return value from runTeacherTelegramBlock.
      telegram_sent: 0,
      telegram_skipped_no_binding: 0,
      telegram_skipped_disabled: 0,
      telegram_terminal_send_failed: 0,
      telegram_bot_blocked: 0,
      telegram_already_sent: 0,
      telegram_row_missing: 0,
    }

    const apiKey = process.env.RESEND_API_KEY?.trim() ?? ''
    const resend = apiKey ? new Resend(apiKey) : null
    /** @type {(params: { from: string, to: string[], subject: string, text: string, html: string, idempotencyKey: string }) => Promise<{ ok: true, emailId: string | null } | { ok: false, message: string }>} */
    const resendSend = async (params) => {
      if (!resend) {
        return { ok: false, message: 'missing_resend_api_key' }
      }
      try {
        const result = await resend.emails.send({
          from: params.from,
          to: params.to,
          subject: params.subject,
          text: params.text,
          html: params.html,
          // resend.emails.send accepts idempotencyKey as a top-level
          // option per the SDK shape used in scripts/auth-flow-alert.mjs.
          idempotencyKey: params.idempotencyKey,
        })
        if (result.error) {
          return { ok: false, message: String(result.error?.message ?? result.error) }
        }
        return { ok: true, emailId: result.data?.id ?? null }
      } catch (err) {
        return {
          ok: false,
          message: err instanceof Error ? err.message : String(err),
        }
      }
    }

    let sentThisTick = 0
    for (const candidate of candidates) {
      counts.teachers_evaluated++
      if (sentThisTick >= rateLimit) {
        // Rate-limit reached — remaining candidates fall to next tick
        // within the firing band.
        break
      }

      let result
      try {
        result = await processOneTeacher({
          pool,
          candidate,
          now: new Date(),
          maxAttempts,
          resendSend,
          // BCS-DEF-5-TG (2026-05-21) — Telegram block on email-sent.
          telegramEnabled,
          tgToken,
        })
      } catch (perTeacherErr) {
        logJson('error', 'per-teacher processing crashed', {
          accountId: candidate.accountId,
          err:
            perTeacherErr instanceof Error
              ? perTeacherErr.message
              : String(perTeacherErr),
        })
        counts.send_failed_transient++
        continue
      }

      switch (result.outcome) {
        case 'outside_band':
          counts.outside_band++
          break
        case 'already_sent':
          counts.already_sent++
          break
        case 'terminal_skip':
          counts.terminal_skip++
          break
        case 'terminal_send_failed':
          counts.terminal_send_failed++
          break
        case 'empty_day':
          counts.empty_day++
          break
        case 'email_missing':
          counts.email_missing++
          break
        case 'sent':
          counts.sent++
          sentThisTick++
          break
        case 'send_failed_transient':
          counts.send_failed_transient++
          sentThisTick++
          break
        default:
          break
      }

      // BCS-DEF-5-TG (2026-05-21) — Telegram outcome counter.
      if (
        result.telegramOutcome !== null
        && result.telegramOutcome !== undefined
      ) {
        const key = `telegram_${result.telegramOutcome}`
        counts[key] = (counts[key] ?? 0) + 1
      }
    }

    logJson('info', 'tick complete', {
      counts,
      thresholds: resolvedThresholds,
    })

    // Step 5 — summary probe_runs row.
    await recordProbeRun(pool, {
      probeName: PROBE_NAMES.TEACHER_DAILY_DIGEST,
      verdictKind: VERDICT_KINDS.DIGEST_SENT,
      stats: { ...counts, thresholds: resolvedThresholds },
    })
  } catch (err) {
    await recordProbeRun(pool, {
      probeName: PROBE_NAMES.TEACHER_DAILY_DIGEST,
      verdictKind: VERDICT_KINDS.ERROR,
      errorMessage: err instanceof Error ? err.message : String(err),
      stats: { thresholds: resolvedThresholds },
    })
    throw err
  } finally {
    await pool.end()
  }
}

const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith('teacher-daily-digest.mjs')

if (invokedDirectly) {
  main().catch((err) => {
    logJson('error', 'teacher-daily-digest crashed', {
      message: err instanceof Error ? err.message : String(err),
    })
    process.exit(1)
  })
}
