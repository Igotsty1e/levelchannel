#!/usr/bin/env node
//
// Server-side webhook-flow health probe. Runs on the VPS as a systemd
// timer (every 30 min by default) and emails the operator if the
// CloudPayments webhook contour looks stalled.
//
// What "stalled" means here:
//
//   created  = COUNT(*) FILTER (WHERE event_type = 'order.created')
//   paid_wh  = COUNT(*) FILTER (WHERE event_type = 'webhook.pay.processed')
//   fail_wh  = COUNT(*) FILTER (WHERE event_type = 'webhook.fail.received')
//   cancel   = COUNT(*) FILTER (WHERE event_type = 'order.cancelled')
//
//   WINDOW = last 1 hour from now()
//
//   verdict:
//     - created < MIN_VOLUME       → low_volume, skip (no signal at low traffic)
//     - paid_wh + fail_wh + cancel >= created → all_resolved, ok
//     - (paid_wh + fail_wh) / created < TERMINATED_RATIO_FLOOR
//                                  → ALERT: webhook flow appears stalled
//     - otherwise                  → ok
//
// Why server-side and not GitHub Actions:
//   - The `payment_audit_events` table needs DB credentials. Exposing
//     audit counters via a public HTTP endpoint either leaks business
//     volume (privacy) or requires an admin auth framework we haven't
//     built yet. Server-side script reads $DATABASE_URL directly.
//   - The script runs in the same trust boundary as the app and reads
//     the same production env values as the main service.
//
// Failure mode:
//   - PG outage → script throws → systemd service exits non-zero →
//     captured in journal but no email (we can't call Resend either).
//     The uptime monitor catches PG outage independently (~5-15 min).
//   - Resend outage → email fails, journal carries the warning. No
//     duplicate alert spam — script doesn't loop.
//
// Idempotence: this script does NOT track "did I already alert about
// this hour-window". Every run sends a fresh email if the verdict is
// alert. Cron interval (30 min) limits the spam to ~2/hour worst-case.
// If that's too loud, add a state file at /var/lib/levelchannel/last-alert
// later — for v1 we accept the noise floor.
//
// Required env (read from the production env file via systemd):
//   DATABASE_URL        — postgres connection
//   RESEND_API_KEY      — Resend SDK key (else email skipped, only journal)
//   EMAIL_FROM          — sender; reused from main app
//   ALERT_EMAIL_TO      — destination (operator)
//
// Tunable env (defaults sane):
//   WEBHOOK_FLOW_WINDOW_MINUTES   default 60
//   WEBHOOK_FLOW_MIN_VOLUME       default 5
//   WEBHOOK_FLOW_TERMINATED_RATIO default 0.3

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

// ALERTS-EDITOR Sub-PR B (2026-05-18) — module-scope `let` vars
// assigned at tick start from operator_settings (DB → env →
// default). Helper functions above main() reference these vars,
// so module-scope is the minimal-touch shape (script is a one-shot
// per cron tick).
let WINDOW_MINUTES = 60
let MIN_VOLUME = 5
let TERMINATED_RATIO_FLOOR = 0.3

const ALERT_EMAIL_TO = process.env.ALERT_EMAIL_TO?.trim() || ''
const EMAIL_FROM = process.env.EMAIL_FROM?.trim() || 'LevelChannel <noreply@example.com>'
const SSH_COMMAND_HINT = process.env.SSH_COMMAND_HINT?.trim() || 'ssh <host>'

// BCS-DEF-1-TG (2026-05-19) — Telegram channel env. Soft-skip on
// missing values per plan §2.2 (no hard boot-fail; email keeps firing).
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN?.trim() || ''
const TELEGRAM_ALERT_CHAT_ID =
  process.env.TELEGRAM_ALERT_CHAT_ID?.trim() || ''
const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.trim() || 'https://levelchannel.ru'

function logJson(level, msg, extra = {}) {
  // Single-line JSON so journald can be parsed mechanically later.
  console.log(
    JSON.stringify({
      level,
      ts: new Date().toISOString(),
      probe: 'webhook-flow-alert',
      msg,
      ...extra,
    }),
  )
}

async function readWindowStats(pool) {
  const { rows } = await pool.query(
    `select
       count(*) filter (where event_type = 'order.created')          as created,
       count(*) filter (where event_type = 'webhook.pay.processed')  as paid_wh,
       count(*) filter (where event_type = 'webhook.fail.received')  as fail_wh,
       count(*) filter (where event_type = 'order.cancelled')        as cancel
     from payment_audit_events
     where created_at > now() - ($1::int * interval '1 minute')`,
    [WINDOW_MINUTES],
  )
  const r = rows[0]
  return {
    created: Number(r.created),
    paidWebhooks: Number(r.paid_wh),
    failWebhooks: Number(r.fail_wh),
    cancelled: Number(r.cancel),
  }
}

// Pure decision logic, exported so it can be unit-tested without
// touching Postgres or Resend.
export function decideVerdict(stats, opts = {}) {
  const minVolume = opts.minVolume ?? MIN_VOLUME
  const ratioFloor = opts.ratioFloor ?? TERMINATED_RATIO_FLOOR

  if (stats.created < minVolume) {
    return { kind: 'low_volume_skip' }
  }
  const terminated = stats.paidWebhooks + stats.failWebhooks
  const resolved = terminated + stats.cancelled
  if (resolved >= stats.created) {
    return { kind: 'all_resolved' }
  }
  const ratio = terminated / stats.created
  if (ratio < ratioFloor) {
    return { kind: 'alert', ratio, terminated, resolved }
  }
  return { kind: 'ok', ratio, terminated, resolved }
}

function decide(stats) {
  return decideVerdict(stats)
}

// BCS-DEF-1-TG (2026-05-19) — Telegram body builder. 4-6 line digest
// + deep-link to /admin/settings/alerts (plan §2.3). Plain text only —
// no Markdown / parse_mode (escape-character footguns aren't worth
// bold/links for a paging signal). Capped at 1024 chars; the 4096-char
// Telegram limit is well above this.
//
// PII-free per plan §4.5: no webhook payloads, no order ids, no
// customer emails. Headline numbers only; operator opens the
// admin page for the full report.
export function buildTelegramBody(stats, verdict) {
  const terminated = stats.paidWebhooks + stats.failWebhooks
  const ratio = typeof verdict.ratio === 'number' ? verdict.ratio.toFixed(2) : '—'
  const lines = [
    'LevelChannel ops — webhook-flow',
    `Только ${terminated} из ${stats.created} закрыты за последние ${WINDOW_MINUTES} мин (доля ${ratio}, порог ${TERMINATED_RATIO_FLOOR})`,
    `Подробнее: ${SITE_URL}/admin/settings/alerts`,
  ]
  return lines.join('\n')
}

// BCS-DEF-1-TG (2026-05-19) — renamed from `sendAlertEmail` to align
// with the per-probe channel-dispatch shape (plan §2.6.1). Same return
// contract {ok, error, emailId} as before.
//
// ALERTS-OBS (2026-05-16) — return contract refactor (mirrors
// auth-flow-alert.mjs change). Caller distinguishes config_missing /
// send_failed / sent.
async function tryEmailChannel({ stats, verdict }) {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    logJson('warn', 'RESEND_API_KEY not set; would have alerted', {
      stats,
      verdict,
    })
    return { ok: false, error: 'missing_resend_api_key' }
  }
  if (!ALERT_EMAIL_TO) {
    logJson('warn', 'ALERT_EMAIL_TO not set; would have alerted', {
      stats,
      verdict,
    })
    return { ok: false, error: 'missing_alert_email_to' }
  }

  const resend = new Resend(apiKey)
  const subject = `[LevelChannel] webhook flow stalled — only ${verdict.terminated}/${stats.created} terminated in last ${WINDOW_MINUTES}m`

  const text = [
    'CloudPayments webhook flow alert.',
    '',
    `Window: last ${WINDOW_MINUTES} minutes.`,
    `Orders created: ${stats.created}`,
    `Pay webhooks processed: ${stats.paidWebhooks}`,
    `Fail webhooks received: ${stats.failWebhooks}`,
    `Orders cancelled by user: ${stats.cancelled}`,
    `Terminated/created ratio: ${verdict.ratio.toFixed(2)} (alert floor ${TERMINATED_RATIO_FLOOR})`,
    '',
    'Diagnose:',
    `  ${SSH_COMMAND_HINT}`,
    '  journalctl -u levelchannel --since "1 hour ago" | grep -i webhook',
    `  psql "$DATABASE_URL" -c "select event_type, count(*) from payment_audit_events where created_at > now() - interval '${WINDOW_MINUTES} minutes' group by 1;"`,
    '',
    'Likely causes:',
    '  - CloudPayments cabinet webhook URLs misconfigured / disabled',
    '  - HMAC secret rotated without updating the production env file',
    '  - nginx blocking webhook IPs (CP user-agent / origin shifts)',
    '  - app handler error — check journalctl for stack traces',
    '',
    'Runbook: OPERATIONS.md §10 + §12.',
  ].join('\n')

  const html = `<p><strong>CloudPayments webhook flow alert.</strong></p>
<p>Window: last ${WINDOW_MINUTES} minutes.</p>
<ul>
  <li>Orders created: <strong>${stats.created}</strong></li>
  <li>Pay webhooks processed: <strong>${stats.paidWebhooks}</strong></li>
  <li>Fail webhooks received: <strong>${stats.failWebhooks}</strong></li>
  <li>Orders cancelled by user: ${stats.cancelled}</li>
  <li>Terminated/created ratio: <strong>${verdict.ratio.toFixed(2)}</strong> (alert floor ${TERMINATED_RATIO_FLOOR})</li>
</ul>
<p>Diagnose: SSH, then <code>journalctl -u levelchannel --since "1 hour ago"</code>. Runbook: <code>OPERATIONS.md §10</code> + <code>§12</code>.</p>`

  // ALERTS-OBS wave-mode WARN #1 closure (2026-05-17): wrap Resend
  // call to convert transport exceptions into the return-contract
  // shape (mirrors auth-flow-alert.mjs).
  let result
  try {
    result = await resend.emails.send({
      from: EMAIL_FROM,
      to: [ALERT_EMAIL_TO],
      subject,
      text,
      html,
    })
  } catch (transportErr) {
    const detail = transportErr instanceof Error ? transportErr.message : String(transportErr)
    logJson('error', 'resend send threw', { error: detail, stats })
    return { ok: false, error: 'resend_send_failed', detail }
  }
  if (result.error) {
    logJson('error', 'resend send failed', {
      error: result.error.message,
      stats,
    })
    return { ok: false, error: 'resend_send_failed', detail: result.error.message }
  }
  logJson('info', 'alert email sent', { to: ALERT_EMAIL_TO, stats, verdict })
  return { ok: true, emailId: result.data?.id ?? null }
}

// BCS-DEF-1-TG (2026-05-19) — Telegram channel dispatch. Sibling of
// `tryEmailChannel`; never throws to outer `main()`. Records its own
// `probe_runs` row with `recipientKind='telegram'`. Plan §2.6.1.
async function tryTelegramChannel({
  pool,
  telegramBody,
  enrichedStats,
  fingerprint,
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
      probeName: PROBE_NAMES.WEBHOOK_FLOW,
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
      probeName: PROBE_NAMES.WEBHOOK_FLOW,
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
    probeName: PROBE_NAMES.WEBHOOK_FLOW,
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
  // start. Assigns module-scope `let` vars before any helper that
  // references them runs.
  // BCS-DEF-1-TG (2026-05-19): also resolve channel-scope Telegram
  // settings (R1 BLOCKER#1 closure — channel keys are invisible to the
  // per-probe resolver).
  const probeSettings = await resolveOperatorSettingsForProbe(
    pool,
    'webhook-flow',
  )
  const channelSettings = await resolveChannelSettings(pool, 'telegram')
  const settings = { ...probeSettings, ...channelSettings }
  WINDOW_MINUTES = settings.WEBHOOK_FLOW_WINDOW_MINUTES.value
  MIN_VOLUME = settings.WEBHOOK_FLOW_MIN_VOLUME.value
  TERMINATED_RATIO_FLOOR = settings.WEBHOOK_FLOW_TERMINATED_RATIO.value
  const telegramEnabled = settings.TELEGRAM_ALERTS_MASTER_SWITCH.value === 1
  const telegramRetryMax = settings.TELEGRAM_ALERTS_RETRY_MAX.value

  const capturedThresholds = {
    WEBHOOK_FLOW_WINDOW_MINUTES: WINDOW_MINUTES,
    WEBHOOK_FLOW_MIN_VOLUME: MIN_VOLUME,
    WEBHOOK_FLOW_TERMINATED_RATIO: TERMINATED_RATIO_FLOOR,
  }
  const capturedThresholdsSource = {
    WEBHOOK_FLOW_WINDOW_MINUTES: settings.WEBHOOK_FLOW_WINDOW_MINUTES.source,
    WEBHOOK_FLOW_MIN_VOLUME: settings.WEBHOOK_FLOW_MIN_VOLUME.source,
    WEBHOOK_FLOW_TERMINATED_RATIO: settings.WEBHOOK_FLOW_TERMINATED_RATIO.source,
  }
  const recipientEmailSnapshot = ALERT_EMAIL_TO || null
  try {
    const stats = await readWindowStats(pool)
    const verdict = decide(stats)
    logJson('info', 'verdict', { stats, verdict })
    const terminated = stats.paidWebhooks + stats.failWebhooks
    const resolved = terminated + stats.cancelled
    const derived = {
      ratio: typeof verdict.ratio === 'number' ? verdict.ratio : null,
      terminated,
      resolved,
    }
    const enrichedStats = {
      ...stats,
      derived,
      thresholds: capturedThresholds,
      thresholds_source: capturedThresholdsSource,
    }
    if (verdict.kind === 'low_volume_skip') {
      await recordProbeRun(pool, {
        probeName: PROBE_NAMES.WEBHOOK_FLOW,
        verdictKind: VERDICT_KINDS.LOW_VOLUME_SKIP,
        stats: enrichedStats,
      })
      return
    }
    if (verdict.kind === 'all_resolved') {
      await recordProbeRun(pool, {
        probeName: PROBE_NAMES.WEBHOOK_FLOW,
        verdictKind: VERDICT_KINDS.ALL_RESOLVED,
        stats: enrichedStats,
      })
      return
    }
    if (verdict.kind === 'ok') {
      await recordProbeRun(pool, {
        probeName: PROBE_NAMES.WEBHOOK_FLOW,
        verdictKind: VERDICT_KINDS.OK,
        stats: enrichedStats,
      })
      return
    }
    // verdict.kind === 'alert' (webhook-flow has NO dedup state by
    // design, so every alert run sends and writes a probe row).
    //
    // BCS-DEF-1-TG R1 BLOCKER#3 closure (2026-05-19): gather-then-
    // dispatch. Build both bodies BEFORE entering channel dispatch;
    // each channel runs inside its own try-block and NEVER returns
    // from main(). Email failure cannot kill the Telegram page.
    const telegramBody = buildTelegramBody(stats, verdict)

    // CHANNEL 1 — email
    try {
      const sendResult = await tryEmailChannel({ stats, verdict })
      if (sendResult.ok) {
        await recordProbeRun(pool, {
          probeName: PROBE_NAMES.WEBHOOK_FLOW,
          verdictKind: VERDICT_KINDS.ALERT_SENT,
          alertSent: true,
          recipientKind: RECIPIENT_KINDS.EMAIL,
          recipientEmail: recipientEmailSnapshot,
          alertEmailId: sendResult.emailId,
          stats: enrichedStats,
        })
      } else {
        const isConfigMissing =
          sendResult.error === 'missing_resend_api_key' ||
          sendResult.error === 'missing_alert_email_to'
        await recordProbeRun(pool, {
          probeName: PROBE_NAMES.WEBHOOK_FLOW,
          verdictKind: isConfigMissing
            ? VERDICT_KINDS.CONFIG_MISSING
            : VERDICT_KINDS.ALERT_SEND_FAILED,
          alertSent: false,
          recipientKind: RECIPIENT_KINDS.EMAIL,
          recipientEmail: recipientEmailSnapshot,
          stats: enrichedStats,
          errorMessage: sendResult.detail ?? sendResult.error,
        })
      }
    } catch (emailErr) {
      logJson('error', 'tryEmailChannel threw unexpectedly', {
        err: emailErr instanceof Error ? emailErr.message : String(emailErr),
      })
      await recordProbeRun(pool, {
        probeName: PROBE_NAMES.WEBHOOK_FLOW,
        verdictKind: VERDICT_KINDS.ALERT_SEND_FAILED,
        recipientKind: RECIPIENT_KINDS.EMAIL,
        recipientEmail: recipientEmailSnapshot,
        stats: enrichedStats,
        errorMessage:
          emailErr instanceof Error ? emailErr.message : String(emailErr),
      })
    }

    // CHANNEL 2 — Telegram, runs regardless of email outcome.
    if (telegramEnabled) {
      try {
        await tryTelegramChannel({
          pool,
          telegramBody,
          enrichedStats,
          fingerprint: null,
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
      probeName: PROBE_NAMES.WEBHOOK_FLOW,
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

// Run main() only when this file is invoked as a script. Importing
// `decideVerdict` from a unit test must not connect to Postgres.
const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith('webhook-flow-alert.mjs')

if (invokedDirectly) {
  main().catch((err) => {
    logJson('error', 'unhandled', { error: err instanceof Error ? err.message : String(err) })
    process.exit(1)
  })
}
