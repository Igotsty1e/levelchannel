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
import {
  resolveChannelSettings,
  resolveOperatorSettingsForProbe,
} from './lib/operator-settings.mjs'
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

// ALERTS-EDITOR Sub-PR B (2026-05-18) — THRESHOLD / REPORT_LIMIT /
// DEDUP_WINDOW_MS are resolved at tick start from operator_settings
// (DB → env → default). Module-scope `let` so buildEmail() and the
// dedup gate (helper closures defined above main()) can reference
// them. Wave-R1 BLOCKER #1 closure — earlier draft used `const`
// inside main() which broke buildEmail with ReferenceError on the
// actual alert path (probe-resolver tests don't exercise that branch).
let THRESHOLD = 3
let REPORT_LIMIT = 10
let DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000

const STATE_FILE = process.env.CALENDAR_PATHOLOGY_STATE_FILE
  ? resolvePath(process.env.CALENDAR_PATHOLOGY_STATE_FILE)
  : resolvePath('./var/calendar-pathology-state.json')

const ALERT_EMAIL_TO = process.env.ALERT_EMAIL_TO?.trim() || ''
const EMAIL_FROM =
  process.env.EMAIL_FROM?.trim() || 'LevelChannel <noreply@example.com>'

// BCS-DEF-1-TG (2026-05-19) — Telegram channel env (plan §2.2).
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN?.trim() || ''
const TELEGRAM_ALERT_CHAT_ID =
  process.env.TELEGRAM_ALERT_CHAT_ID?.trim() || ''
const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.trim() || 'https://levelchannel.ru'

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

// BCS-DEF-1-TG (2026-05-19) — Telegram body for calendar-pathology
// (plan §2.3). 4-line digest + deep-link; no slot IDs, no calendar IDs,
// no teacher IDs (PII guard §4.5).
export function buildTelegramBody(offenders) {
  const lines = [
    'LevelChannel ops — calendar-pathology',
    `${offenders.length} «воскресающих» слотов с cancel_repush_count ≥ ${THRESHOLD}`,
    `Подробнее: ${SITE_URL}/admin/settings/alerts`,
  ]
  return lines.join('\n')
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

// BCS-DEF-1-TG R2 BLOCKER#2 closure (2026-05-19) — calendar-pathology
// was the one probe with inline email; extracted into per-probe
// `tryEmailChannel` to match the gather-then-dispatch shape. Mirror of
// webhook-flow's helper: `{ok, error, detail?, emailId?}` return.
async function tryEmailChannel({ offenders }) {
  if (!ALERT_EMAIL_TO || !process.env.RESEND_API_KEY) {
    return {
      ok: false,
      error: !ALERT_EMAIL_TO
        ? 'missing_alert_email_to'
        : 'missing_resend_api_key',
    }
  }
  const { subject, text } = buildEmail(offenders)
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

// BCS-DEF-1-TG (2026-05-19) — Telegram channel dispatch. Never throws
// to outer main(). Records its own probe_runs row.
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
      probeName: PROBE_NAMES.CALENDAR_PATHOLOGY,
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
      probeName: PROBE_NAMES.CALENDAR_PATHOLOGY,
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
    probeName: PROBE_NAMES.CALENDAR_PATHOLOGY,
    verdictKind: VERDICT_KINDS.ALERT_SEND_FAILED,
    recipientKind: RECIPIENT_KINDS.TELEGRAM,
    recipientEmail: TELEGRAM_ALERT_CHAT_ID,
    fingerprint,
    stats: enrichedStats,
    errorMessage: redactedDetail || tgResult.error,
  })
  return false
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

  // ALERTS-EDITOR Sub-PR B (2026-05-18) — snapshot read at tick
  // start. ONE round-trip; the resolved values + sources are the
  // immutable config for the rest of this tick.
  // BCS-DEF-1-TG (2026-05-19): also resolve channel-scope Telegram
  // settings.
  const probeSettings = await resolveOperatorSettingsForProbe(
    pool,
    'calendar-pathology',
  )
  const channelSettings = await resolveChannelSettings(pool, 'telegram')
  const settings = { ...probeSettings, ...channelSettings }
  THRESHOLD = settings.CALENDAR_PATHOLOGY_THRESHOLD.value
  REPORT_LIMIT = settings.CALENDAR_PATHOLOGY_REPORT_LIMIT.value
  DEDUP_WINDOW_MS = settings.CALENDAR_PATHOLOGY_DEDUP_WINDOW_MS.value
  const telegramEnabled = settings.TELEGRAM_ALERTS_MASTER_SWITCH.value === 1
  const telegramRetryMax = settings.TELEGRAM_ALERTS_RETRY_MAX.value

  // R2 BLOCKER #4 closure — scalar `thresholds` for backwards
  // compatibility with /admin/settings/alerts rendering; new
  // parallel `thresholds_source` exposes (db | env | default)
  // per-key for the editor UI to consume in Sub-PR C.
  const capturedThresholds = {
    CALENDAR_PATHOLOGY_THRESHOLD: THRESHOLD,
    CALENDAR_PATHOLOGY_REPORT_LIMIT: REPORT_LIMIT,
    CALENDAR_PATHOLOGY_DEDUP_WINDOW_MS: DEDUP_WINDOW_MS,
  }
  const capturedThresholdsSource = {
    CALENDAR_PATHOLOGY_THRESHOLD: settings.CALENDAR_PATHOLOGY_THRESHOLD.source,
    CALENDAR_PATHOLOGY_REPORT_LIMIT: settings.CALENDAR_PATHOLOGY_REPORT_LIMIT.source,
    CALENDAR_PATHOLOGY_DEDUP_WINDOW_MS: settings.CALENDAR_PATHOLOGY_DEDUP_WINDOW_MS.source,
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
        stats: {
          offenderCount: 0,
          thresholds: capturedThresholds,
          thresholds_source: capturedThresholdsSource,
        },
      })
      return
    }

    const enrichedStats = {
      offenderCount: offenders.length,
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
      logJson('info', 'offenders unchanged within dedup window; skipping email', {
        offenderCount: offenders.length,
        fingerprint: fp,
        windowMs: DEDUP_WINDOW_MS,
      })
      // BCS-DEF-1-TG R2 WARN#2 closure (2026-05-19): dedup_skip emits
      // one row per channel — Telegram row only if master switch on.
      await recordProbeRun(pool, {
        probeName: PROBE_NAMES.CALENDAR_PATHOLOGY,
        verdictKind: VERDICT_KINDS.DEDUP_SKIP,
        recipientKind: RECIPIENT_KINDS.EMAIL,
        fingerprint: fp,
        stats: enrichedStats,
      })
      if (telegramEnabled) {
        await recordProbeRun(pool, {
          probeName: PROBE_NAMES.CALENDAR_PATHOLOGY,
          verdictKind: VERDICT_KINDS.DEDUP_SKIP,
          recipientKind: RECIPIENT_KINDS.TELEGRAM,
          fingerprint: fp,
          stats: enrichedStats,
        })
      }
      return
    }

    // BCS-DEF-1-TG R1 BLOCKER#3 closure — gather-then-dispatch.
    const telegramBody = buildTelegramBody(offenders)

    // CHANNEL 1 — email
    let emailOk = false
    try {
      const sendResult = await tryEmailChannel({ offenders })
      if (sendResult.ok) {
        emailOk = true
        logJson('info', 'pathology alert email sent', {
          offenderCount: offenders.length,
          fingerprint: fp,
          emailId: sendResult.emailId,
        })
        await recordProbeRun(pool, {
          probeName: PROBE_NAMES.CALENDAR_PATHOLOGY,
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
            { offenderCount: offenders.length },
          )
        } else {
          logJson('warn', 'resend send failed; state NOT advanced', {
            error: sendResult.detail ?? sendResult.error,
          })
        }
        await recordProbeRun(pool, {
          probeName: PROBE_NAMES.CALENDAR_PATHOLOGY,
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
        probeName: PROBE_NAMES.CALENDAR_PATHOLOGY,
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
      // State file is EMAIL-controlled (RISK-3); Telegram outcome does
      // NOT touch it.
      await writeState({ lastAlertAt: now, lastFingerprint: fp })
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
  } catch (err) {
    // ALERTS-OBS round-3 WARN #5 closure: top-level catch writes
    // an `error` verdict row BEFORE re-throwing.
    await recordProbeRun(pool, {
      probeName: PROBE_NAMES.CALENDAR_PATHOLOGY,
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

main().catch((err) => {
  logJson('error', 'calendar-pathology-alert crashed', {
    message: err instanceof Error ? err.message : String(err),
  })
  process.exit(1)
})
