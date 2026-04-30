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
//   - The script runs in the same trust boundary as the app — same
//     systemd unit family, same env file.
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
// Required env (read from /etc/levelchannel.env via systemd):
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

const WINDOW_MINUTES = Number(process.env.WEBHOOK_FLOW_WINDOW_MINUTES || 60)
const MIN_VOLUME = Number(process.env.WEBHOOK_FLOW_MIN_VOLUME || 5)
const TERMINATED_RATIO_FLOOR = Number(
  process.env.WEBHOOK_FLOW_TERMINATED_RATIO || 0.3,
)

const ALERT_EMAIL_TO = process.env.ALERT_EMAIL_TO?.trim() || ''
const EMAIL_FROM = process.env.EMAIL_FROM?.trim() || 'LevelChannel <noreply@example.com>'
const SSH_COMMAND_HINT = process.env.SSH_COMMAND_HINT?.trim() || 'ssh <host>'

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

async function sendAlertEmail({ stats, verdict }) {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    logJson('warn', 'RESEND_API_KEY not set; would have alerted', {
      stats,
      verdict,
    })
    return
  }
  if (!ALERT_EMAIL_TO) {
    logJson('warn', 'ALERT_EMAIL_TO not set; would have alerted', {
      stats,
      verdict,
    })
    return
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
    '  - HMAC secret rotated without updating /etc/levelchannel.env',
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

  const result = await resend.emails.send({
    from: EMAIL_FROM,
    to: [ALERT_EMAIL_TO],
    subject,
    text,
    html,
  })
  if (result.error) {
    logJson('error', 'resend send failed', {
      error: result.error.message,
      stats,
    })
    return
  }
  logJson('info', 'alert email sent', { to: ALERT_EMAIL_TO, stats, verdict })
}

async function main() {
  if (!process.env.DATABASE_URL) {
    logJson('error', 'DATABASE_URL not set; aborting')
    process.exit(2)
  }
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
  })
  try {
    const stats = await readWindowStats(pool)
    const verdict = decide(stats)
    logJson('info', 'verdict', { stats, verdict })
    if (verdict.kind === 'alert') {
      await sendAlertEmail({ stats, verdict })
    }
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
