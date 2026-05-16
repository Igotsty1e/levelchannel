#!/usr/bin/env node
//
// BCS-G.3 — Calendar pathology alert probe.
//
// Sibling of scripts/auth-flow-alert.mjs and scripts/webhook-flow-alert.mjs.
// Runs on the VPS as a systemd timer (default every 4 hours) and
// emails the operator when any lesson_slot has crossed the
// cancel_repush_count >= 3 threshold — that's the F9‴ pathology
// described in migration 0042 and plan §4.8 minor note 2.
//
// Source of truth for the predicate: `lib/calendar/pathology.ts`
// (TS lib, used by tests + future admin endpoint). This script
// inlines the same SELECT because .mjs cannot import .ts.
//
// Why a separate cron from the reconcile sweep itself: the alert
// is a different concern (operator notification) with a different
// cadence (slow, deduped) than the healing (daily, exhaustive).
// Coupling them would mean either over-paging or under-healing.
//
// Thresholds (env-tunable):
//
//   CALENDAR_PATHOLOGY_THRESHOLD     default 3   (cancel_repush_count)
//   CALENDAR_PATHOLOGY_REPORT_LIMIT  default 10  (top-N in alert body)
//   CALENDAR_PATHOLOGY_DEDUP_WINDOW_MS  default 24h
//   CALENDAR_PATHOLOGY_STATE_FILE       default ./var/calendar-pathology-state.json
//
// Required env:
//   DATABASE_URL        — postgres connection
//   RESEND_API_KEY      — Resend SDK key (else email skipped, only journal)
//   EMAIL_FROM          — sender (reused from main app)
//   ALERT_EMAIL_TO      — destination (operator)
//
// Failure mode + idempotence: same as siblings.
//   - PG outage → throw → systemd captures non-zero, no email
//   - Resend outage → email fails, journal carries warning
//   - Dedup-window file prevents re-paging on same offender-set

import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve as resolvePath } from 'node:path'

import pg from 'pg'
import { Resend } from 'resend'

import { resolveSslConfig } from './_pg-ssl.mjs'
import { recordProbeRun, PROBE_NAMES, VERDICT_KINDS } from './lib/probe-runs.mjs'

const THRESHOLD = Number(process.env.CALENDAR_PATHOLOGY_THRESHOLD || 3)
const REPORT_LIMIT = Math.max(
  1,
  Math.min(Number(process.env.CALENDAR_PATHOLOGY_REPORT_LIMIT || 10), 100),
)
const DEDUP_WINDOW_MS = Number(
  process.env.CALENDAR_PATHOLOGY_DEDUP_WINDOW_MS || 24 * 60 * 60 * 1000,
)
const STATE_FILE = process.env.CALENDAR_PATHOLOGY_STATE_FILE
  ? resolvePath(process.env.CALENDAR_PATHOLOGY_STATE_FILE)
  : resolvePath('./var/calendar-pathology-state.json')

const ALERT_EMAIL_TO = process.env.ALERT_EMAIL_TO?.trim() || ''
const EMAIL_FROM =
  process.env.EMAIL_FROM?.trim() || 'LevelChannel <noreply@example.com>'

function logJson(level, msg, extra = {}) {
  console.log(
    JSON.stringify({
      level,
      ts: new Date().toISOString(),
      probe: 'calendar-pathology-alert',
      msg,
      ...extra,
    }),
  )
}

async function readOffenders(pool) {
  const r = await pool.query(
    `select id,
            teacher_account_id,
            start_at,
            external_calendar_id,
            external_event_id,
            cancel_repush_count,
            last_reconciled_at
       from lesson_slots
      where status = 'cancelled'
        and external_event_id is not null
        and cancel_repush_count >= $1
      order by cancel_repush_count desc, start_at asc
      limit $2`,
    [THRESHOLD, REPORT_LIMIT],
  )
  return r.rows.map((row) => ({
    slotId: String(row.id),
    teacherAccountId: String(row.teacher_account_id),
    startAt: new Date(String(row.start_at)).toISOString(),
    externalCalendarId: String(row.external_calendar_id),
    externalEventId: String(row.external_event_id),
    cancelRepushCount: Number(row.cancel_repush_count),
    lastReconciledAt:
      row.last_reconciled_at === null
        ? null
        : new Date(String(row.last_reconciled_at)).toISOString(),
  }))
}

function fingerprint(offenders) {
  // Same offender-set fingerprint shape as auth-flow-alert: stable
  // hash over (slotId, count) tuples so a single resurrected loop
  // dedups against a previous run.
  const repr = offenders
    .map((o) => `${o.slotId}:${o.cancelRepushCount}`)
    .sort()
    .join('|')
  return createHash('sha256').update(repr).digest('hex').slice(0, 16)
}

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

function buildEmail(offenders) {
  const lines = offenders
    .map(
      (o, i) =>
        `${i + 1}. slot=${o.slotId} teacher=${o.teacherAccountId} ` +
        `cancel_repush_count=${o.cancelRepushCount} start=${o.startAt} ` +
        `last_reconciled_at=${o.lastReconciledAt ?? '—'}`,
    )
    .join('\n')
  const text =
    `LevelChannel calendar pathology alert.\n` +
    `\n` +
    `${offenders.length} cancelled slot(s) have cancel_repush_count >= ${THRESHOLD}.\n` +
    `This means the reconcile sweep has re-enqueued a delete for the same\n` +
    `slot's Google event ${THRESHOLD}+ times — the event keeps resurrecting\n` +
    `(operator manually recreating it? bot? broken delete path?).\n` +
    `\n` +
    `Top offenders (up to ${REPORT_LIMIT}):\n` +
    `\n` +
    `${lines}\n` +
    `\n` +
    `Action: investigate why the delete isn't sticking. Likely cause is\n` +
    `the operator/teacher creating the event back from inside Google's UI,\n` +
    `or a Google-side automation re-creating it. If neither applies, the\n` +
    `push worker's delete path may be broken — check journalctl on the VPS.\n`
  const subject = `[LevelChannel] Calendar pathology: ${offenders.length} resurrected slot(s)`
  return { subject, text }
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

  // ALERTS-OBS (2026-05-16) — capture env snapshot at the top of
  // the run.
  const capturedThresholds = {
    CALENDAR_PATHOLOGY_THRESHOLD: THRESHOLD,
    CALENDAR_PATHOLOGY_REPORT_LIMIT: REPORT_LIMIT,
    CALENDAR_PATHOLOGY_DEDUP_WINDOW_MS: DEDUP_WINDOW_MS,
  }
  const recipientEmailSnapshot = ALERT_EMAIL_TO || null

  try {
    const offenders = await readOffenders(pool)
    if (offenders.length === 0) {
      logJson('info', 'no offenders above threshold', {
        threshold: THRESHOLD,
      })
      await recordProbeRun(pool, {
        probeName: PROBE_NAMES.CALENDAR_PATHOLOGY,
        verdictKind: VERDICT_KINDS.NO_OFFENDERS,
        stats: { offenderCount: 0, thresholds: capturedThresholds },
      })
      return
    }

    const enrichedStats = {
      offenderCount: offenders.length,
      thresholds: capturedThresholds,
    }

    const fp = fingerprint(offenders)
    const state = await readState()
    const now = Date.now()
    if (
      state.lastFingerprint === fp
      && state.lastAlertAt
      && now - state.lastAlertAt < DEDUP_WINDOW_MS
    ) {
      logJson('info', 'offenders unchanged within dedup window; skipping email', {
        offenderCount: offenders.length,
        fingerprint: fp,
        windowMs: DEDUP_WINDOW_MS,
      })
      await recordProbeRun(pool, {
        probeName: PROBE_NAMES.CALENDAR_PATHOLOGY,
        verdictKind: VERDICT_KINDS.DEDUP_SKIP,
        fingerprint: fp,
        stats: enrichedStats,
      })
      return
    }

    const { subject, text } = buildEmail(offenders)
    if (!ALERT_EMAIL_TO || !process.env.RESEND_API_KEY) {
      // BCS-G retro Codex round 1 WARN #3 — DO NOT advance dedup
      // state when the operator hasn't actually been paged. The
      // misconfig (missing ALERT_EMAIL_TO / RESEND_API_KEY) is a
      // transient operator issue; on fix the next run should re-fire
      // immediately, not wait out the 24h dedup window.
      logJson('warn', 'alert would fire but email destination/key not set; state NOT advanced', {
        offenderCount: offenders.length,
      })
      await recordProbeRun(pool, {
        probeName: PROBE_NAMES.CALENDAR_PATHOLOGY,
        verdictKind: VERDICT_KINDS.CONFIG_MISSING,
        recipientEmail: recipientEmailSnapshot,
        fingerprint: fp,
        stats: enrichedStats,
        errorMessage: !ALERT_EMAIL_TO ? 'missing_alert_email_to' : 'missing_resend_api_key',
      })
      return
    }

    const resend = new Resend(process.env.RESEND_API_KEY)
    // ALERTS-OBS wave-mode WARN #1 closure (2026-05-17): wrap Resend
    // call so transport exceptions (network/DNS/TLS) get classified
    // as alert_send_failed too, not bubbled to the top-level `error`
    // catch.
    let sent
    try {
      sent = await resend.emails.send({
        from: EMAIL_FROM,
        to: [ALERT_EMAIL_TO],
        subject,
        text,
      })
    } catch (transportErr) {
      const detail = transportErr instanceof Error ? transportErr.message : String(transportErr)
      logJson('warn', 'resend send threw; state NOT advanced', { error: detail })
      await recordProbeRun(pool, {
        probeName: PROBE_NAMES.CALENDAR_PATHOLOGY,
        verdictKind: VERDICT_KINDS.ALERT_SEND_FAILED,
        recipientEmail: recipientEmailSnapshot,
        fingerprint: fp,
        stats: enrichedStats,
        errorMessage: detail,
      })
      return
    }
    if (sent.error) {
      // BCS-G retro Codex round 1 WARN #3 — Resend outage / transient
      // failure → state NOT advanced. The next run re-attempts the
      // page instead of silencing the same offender set for the
      // dedup window.
      logJson('warn', 'resend email failed; state NOT advanced', {
        error: String(sent.error),
      })
      await recordProbeRun(pool, {
        probeName: PROBE_NAMES.CALENDAR_PATHOLOGY,
        verdictKind: VERDICT_KINDS.ALERT_SEND_FAILED,
        recipientEmail: recipientEmailSnapshot,
        fingerprint: fp,
        stats: enrichedStats,
        errorMessage: String(sent.error),
      })
      return
    }

    logJson('info', 'pathology alert email sent', {
      offenderCount: offenders.length,
      fingerprint: fp,
      emailId: sent.data?.id ?? null,
    })
    await writeState({ lastAlertAt: now, lastFingerprint: fp })
    await recordProbeRun(pool, {
      probeName: PROBE_NAMES.CALENDAR_PATHOLOGY,
      verdictKind: VERDICT_KINDS.ALERT_SENT,
      alertSent: true,
      recipientEmail: recipientEmailSnapshot,
      alertEmailId: sent.data?.id ?? null,
      fingerprint: fp,
      stats: enrichedStats,
    })
  } catch (err) {
    // ALERTS-OBS round-3 WARN #5 closure: top-level catch writes
    // an `error` verdict row BEFORE re-throwing.
    await recordProbeRun(pool, {
      probeName: PROBE_NAMES.CALENDAR_PATHOLOGY,
      verdictKind: VERDICT_KINDS.ERROR,
      errorMessage: err instanceof Error ? err.message : String(err),
      stats: { thresholds: capturedThresholds },
    })
    throw err
  } finally {
    await pool.end()
  }
}

main().catch((err) => {
  logJson('error', 'calendar-pathology-alert crashed', {
    message: err instanceof Error ? err.message : String(err),
  })
  process.exit(1)
})
