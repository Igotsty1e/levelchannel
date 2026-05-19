#!/usr/bin/env node
//
// Wave 5 (security observability) — auth-flow alert probe.
//
// Sibling of scripts/webhook-flow-alert.mjs. Runs on the VPS as a
// systemd timer (every 30 min by default) and emails the operator
// when failed login activity exceeds slow-brute-force thresholds.
//
// Why this exists:
//
//   The IP rate limit (10/min) and per-email rate limit (5/min) bound
//   the per-minute rate but a patient attacker pacing under both leaves
//   no signal beyond raw nginx access logs. Migration 0028 added
//   `auth_audit_events`; lib/audit/auth-events.ts records every
//   `auth.login.failed` attempt with email_hash + IP. This script
//   aggregates those rows and pages the operator when patterns emerge.
//
// Thresholds (defaults, env-tunable):
//
//   AUTH_FLOW_WINDOW_MINUTES      default 60
//   AUTH_FLOW_MAX_PER_IP          default 50
//   AUTH_FLOW_MAX_PER_EMAIL_HASH  default 20
//
//   verdict:
//     - any client_ip with >MAX_PER_IP failed logins in window → ALERT
//     - any email_hash with >MAX_PER_EMAIL_HASH failed in window → ALERT
//     - otherwise → ok
//
// What we DO NOT alert on:
//   - Successful logins (info, not threat)
//   - Reset / verify activity (covered by per-route rate limits; brute-
//     forcing a reset link is a different threat surface, separate alert
//     can be added later if needed)
//   - Failed logins with no IP (would happen if getClientIp returns null,
//     which happens when XFF is missing AND remoteAddress isn't
//     accessible — rare; we don't aggregate these because they're
//     noise from probe / health-check tools that don't have a real IP)
//
// Failure mode + idempotence: same as webhook-flow-alert.
//   - PG outage → script throws → systemd captures non-zero, no email
//   - Resend outage → email fails, journal carries warning
//   - Every cron run sends a fresh email if verdict is alert. 30-min
//     interval limits spam to ~2/hour worst-case
//
// Required env (read from production env file via systemd):
//   DATABASE_URL        — postgres connection
//   RESEND_API_KEY      — Resend SDK key (else email skipped, only journal)
//   EMAIL_FROM          — sender; reused from main app
//   ALERT_EMAIL_TO      — destination (operator)

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

// ALERTS-EDITOR Sub-PR B (2026-05-18) — WINDOW_MINUTES /
// MAX_PER_IP / MAX_PER_EMAIL_HASH / DEDUP_WINDOW_MS are resolved
// at tick start from operator_settings (DB → env → default).
// Module-scope `let` so helper functions defined above main() can
// reference them; assignment happens once inside main() before any
// helper is called. The script is a one-shot per cron tick — no
// concurrent invocations to worry about.
let WINDOW_MINUTES = 60
let MAX_PER_IP = 50
let MAX_PER_EMAIL_HASH = 20
let DEDUP_WINDOW_MS = 4 * 60 * 60 * 1000

const STATE_FILE = process.env.AUTH_FLOW_STATE_FILE
  ? resolvePath(process.env.AUTH_FLOW_STATE_FILE)
  : resolvePath('./var/auth-flow-alert-state.json')

const ALERT_EMAIL_TO = process.env.ALERT_EMAIL_TO?.trim() || ''
const EMAIL_FROM =
  process.env.EMAIL_FROM?.trim() || 'LevelChannel <noreply@example.com>'
const SSH_COMMAND_HINT = process.env.SSH_COMMAND_HINT?.trim() || 'ssh <host>'

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
      probe: 'auth-flow-alert',
      msg,
      ...extra,
    }),
  )
}

async function readWindowStats(pool) {
  // Two queries — both indexes are already in place (migration 0028).
  // We only ask for top offenders, not full distribution; alert text
  // shows up to 5 per axis.
  const ipQuery = pool.query(
    `select client_ip, count(*)::int as failures
       from auth_audit_events
      where event_type = 'auth.login.failed'
        and created_at > now() - ($1::int * interval '1 minute')
        and client_ip is not null
      group by client_ip
      having count(*) > $2
      order by failures desc
      limit 5`,
    [WINDOW_MINUTES, MAX_PER_IP],
  )
  const emailQuery = pool.query(
    `select email_hash, count(*)::int as failures
       from auth_audit_events
      where event_type = 'auth.login.failed'
        and created_at > now() - ($1::int * interval '1 minute')
      group by email_hash
      having count(*) > $2
      order by failures desc
      limit 5`,
    [WINDOW_MINUTES, MAX_PER_EMAIL_HASH],
  )
  const totalQuery = pool.query(
    `select count(*)::int as total_failed
       from auth_audit_events
      where event_type = 'auth.login.failed'
        and created_at > now() - ($1::int * interval '1 minute')`,
    [WINDOW_MINUTES],
  )

  const [ips, emails, total] = await Promise.all([ipQuery, emailQuery, totalQuery])
  return {
    totalFailed: Number(total.rows[0].total_failed),
    offendingIps: ips.rows.map((r) => ({
      ip: String(r.client_ip),
      failures: Number(r.failures),
    })),
    offendingEmailHashes: emails.rows.map((r) => ({
      // Only show first 8 chars of the hash in the email — full hash
      // is in DB. Operator queries the full row themselves if needed.
      emailHashShort: String(r.email_hash).slice(0, 8),
      failures: Number(r.failures),
    })),
  }
}

// Pure decision logic, exported so it can be unit-tested without
// touching Postgres or Resend.
export function decideVerdict(stats) {
  if (
    stats.offendingIps.length > 0 ||
    stats.offendingEmailHashes.length > 0
  ) {
    return { kind: 'alert' }
  }
  if (stats.totalFailed === 0) {
    return { kind: 'no_failures' }
  }
  return { kind: 'ok' }
}

// Stable hash of the offender set. Two stats with the same set of
// (ip, failures) and (email_hash, failures) produce the same
// fingerprint, regardless of order. Counts ARE part of the
// fingerprint so an escalation (same offenders but higher counts)
// fires a fresh alert.
//
// Exported for unit tests.
export function offenderFingerprint(stats) {
  const ips = [...stats.offendingIps]
    .map((r) => `${r.ip}:${r.failures}`)
    .sort()
    .join(',')
  const emails = [...stats.offendingEmailHashes]
    .map((r) => `${r.emailHashShort}:${r.failures}`)
    .sort()
    .join(',')
  return createHash('sha256').update(`ips=${ips}|emails=${emails}`).digest('hex').slice(0, 16)
}

// Best-effort state read. Missing/corrupt file → no dedup; we fire
// the alert. Operator wants false-positive ALERTS over false-negative
// SILENT.
async function readDedupState(stateFile) {
  try {
    const raw = await readFile(stateFile, 'utf8')
    const parsed = JSON.parse(raw)
    if (
      typeof parsed?.fingerprint === 'string' &&
      typeof parsed?.sentAtMs === 'number'
    ) {
      return { fingerprint: parsed.fingerprint, sentAtMs: parsed.sentAtMs }
    }
    return null
  } catch {
    return null
  }
}

async function writeDedupState(stateFile, state) {
  try {
    await mkdir(dirname(stateFile), { recursive: true })
    await writeFile(stateFile, JSON.stringify(state), 'utf8')
  } catch (err) {
    logJson('warn', 'failed to persist dedup state', {
      error: err instanceof Error ? err.message : String(err),
      stateFile,
    })
  }
}

// Pure decision: should we suppress the email because we already
// alerted on the same offender set within the dedup window?
//
// Exported for unit tests.
export function shouldSuppress({
  fingerprint,
  prevState,
  nowMs,
  windowMs,
}) {
  if (!prevState) return false
  if (prevState.fingerprint !== fingerprint) return false
  return nowMs - prevState.sentAtMs < windowMs
}

// BCS-DEF-1-TG (2026-05-19) — Telegram body for auth-flow probe (plan
// §2.3). Headline + total + deep-link; NO email_hash bits, NO IPs.
// Operator opens the admin page for the offender breakdown — email
// inbox still carries the detail under TLS.
export function buildTelegramBody(stats) {
  const lines = [
    'LevelChannel ops — auth-flow',
    `${stats.totalFailed} попыток входа с ошибкой за последние ${WINDOW_MINUTES} мин (IP над порогом: ${stats.offendingIps.length}, email-хэш над порогом: ${stats.offendingEmailHashes.length})`,
    `Подробнее: ${SITE_URL}/admin/settings/alerts`,
  ]
  return lines.join('\n')
}

// BCS-DEF-1-TG (2026-05-19) — renamed from `sendAlertEmail`, plan §2.6.1
// R3 WARN#2 closure: auth-flow already had this helper so we keep the
// shape and rename only.
//
// ALERTS-OBS (2026-05-16) — return contract refactor.
// Caller distinguishes config_missing / send_failed / sent so it can
// (a) advance dedup state ONLY on a real send and (b) record the
// right verdict_kind in probe_runs. Previously this function returned
// undefined on every path, so the caller always advanced dedup
// state — a real bug that silently masked retries on missing-key
// or Resend-outage failures (paranoia round-1 BLOCKER #5).
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
  const totalOffenders =
    stats.offendingIps.length + stats.offendingEmailHashes.length
  const subject = `[LevelChannel] auth brute-force pattern — ${totalOffenders} offender(s) over thresholds in last ${WINDOW_MINUTES}m`

  const ipLines = stats.offendingIps.length
    ? stats.offendingIps
        .map((r) => `  - ${r.ip}: ${r.failures} failed (threshold ${MAX_PER_IP})`)
        .join('\n')
    : '  (none over threshold)'
  const emailLines = stats.offendingEmailHashes.length
    ? stats.offendingEmailHashes
        .map(
          (r) =>
            `  - email_hash[${r.emailHashShort}…]: ${r.failures} failed (threshold ${MAX_PER_EMAIL_HASH})`,
        )
        .join('\n')
    : '  (none over threshold)'

  const text = [
    'Auth brute-force pattern detected.',
    '',
    `Window: last ${WINDOW_MINUTES} minutes.`,
    `Total auth.login.failed in window: ${stats.totalFailed}`,
    '',
    `Offending IPs (>${MAX_PER_IP} failed):`,
    ipLines,
    '',
    `Offending email hashes (>${MAX_PER_EMAIL_HASH} failed):`,
    emailLines,
    '',
    'Diagnose:',
    `  ${SSH_COMMAND_HINT}`,
    `  psql "$DATABASE_URL" -c "select event_type, client_ip, count(*) from auth_audit_events where event_type='auth.login.failed' and created_at > now() - interval '${WINDOW_MINUTES} minutes' group by 1, 2 order by 3 desc limit 20;"`,
    '  journalctl -u levelchannel --since "1 hour ago" | grep -i auth',
    '',
    'Likely causes:',
    '  - Credential-stuffing run from a bot net (rotate IPs, single-email-many or many-emails-single)',
    '  - Operator-side test / friendly probe (verify before responding)',
    '  - Compromised credential leak elsewhere on the internet — check HIBP',
    '',
    'Response options:',
    '  - nginx-level deny for the IP (add to /etc/nginx/conf.d/deny.conf, reload)',
    '  - Tighten per-IP rate-limit if pattern is persistent',
    '  - Email the targeted user(s) if email_hash maps to a real account (operator query)',
  ].join('\n')

  const html = `<p><strong>Auth brute-force pattern detected.</strong></p>
<p>Window: last ${WINDOW_MINUTES} minutes. Total <code>auth.login.failed</code>: <strong>${stats.totalFailed}</strong>.</p>
<p><strong>Offending IPs</strong> (>${MAX_PER_IP} failed):</p>
<pre>${ipLines}</pre>
<p><strong>Offending email hashes</strong> (>${MAX_PER_EMAIL_HASH} failed):</p>
<pre>${emailLines}</pre>
<p>Diagnose: SSH, then <code>psql</code> against <code>auth_audit_events</code>. See plain-text version of this email for full commands.</p>`

  // ALERTS-OBS wave-mode WARN #1 closure (2026-05-17): wrap the
  // Resend SDK call so transport-level exceptions (network error,
  // DNS, TLS, etc.) yield `alert_send_failed` via the return
  // contract instead of bubbling to the probe's top-level catch as
  // a generic `error` verdict.
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

// BCS-DEF-1-TG (2026-05-19) — Telegram channel dispatch (plan §2.6.1).
// Never throws to outer main(). Records its own probe_runs row with
// recipientKind='telegram'.
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
      probeName: PROBE_NAMES.AUTH_FLOW,
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
      probeName: PROBE_NAMES.AUTH_FLOW,
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
    probeName: PROBE_NAMES.AUTH_FLOW,
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
  // start. ONE round-trip; assigns the module-scope `let` vars
  // before any helper that references them is called.
  // BCS-DEF-1-TG (2026-05-19): also resolve channel-scope Telegram
  // settings (R1 BLOCKER#1 closure).
  const probeSettings = await resolveOperatorSettingsForProbe(
    pool,
    'auth-flow',
  )
  const channelSettings = await resolveChannelSettings(pool, 'telegram')
  const settings = { ...probeSettings, ...channelSettings }
  WINDOW_MINUTES = settings.AUTH_FLOW_WINDOW_MINUTES.value
  MAX_PER_IP = settings.AUTH_FLOW_MAX_PER_IP.value
  MAX_PER_EMAIL_HASH = settings.AUTH_FLOW_MAX_PER_EMAIL_HASH.value
  DEDUP_WINDOW_MS = settings.AUTH_FLOW_DEDUP_WINDOW_MS.value
  const telegramEnabled = settings.TELEGRAM_ALERTS_MASTER_SWITCH.value === 1
  const telegramRetryMax = settings.TELEGRAM_ALERTS_RETRY_MAX.value

  const capturedThresholds = {
    AUTH_FLOW_WINDOW_MINUTES: WINDOW_MINUTES,
    AUTH_FLOW_MAX_PER_IP: MAX_PER_IP,
    AUTH_FLOW_MAX_PER_EMAIL_HASH: MAX_PER_EMAIL_HASH,
    AUTH_FLOW_DEDUP_WINDOW_MS: DEDUP_WINDOW_MS,
  }
  const capturedThresholdsSource = {
    AUTH_FLOW_WINDOW_MINUTES: settings.AUTH_FLOW_WINDOW_MINUTES.source,
    AUTH_FLOW_MAX_PER_IP: settings.AUTH_FLOW_MAX_PER_IP.source,
    AUTH_FLOW_MAX_PER_EMAIL_HASH: settings.AUTH_FLOW_MAX_PER_EMAIL_HASH.source,
    AUTH_FLOW_DEDUP_WINDOW_MS: settings.AUTH_FLOW_DEDUP_WINDOW_MS.source,
  }
  const recipientEmailSnapshot = ALERT_EMAIL_TO || null
  try {
    const stats = await readWindowStats(pool)
    const verdict = decideVerdict(stats)
    logJson('info', 'verdict', { stats, verdict })
    const enrichedStats = {
      ...stats,
      thresholds: capturedThresholds,
      thresholds_source: capturedThresholdsSource,
    }
    if (verdict.kind === 'no_failures') {
      await recordProbeRun(pool, {
        probeName: PROBE_NAMES.AUTH_FLOW,
        verdictKind: VERDICT_KINDS.NO_FAILURES,
        stats: enrichedStats,
      })
      return
    }
    if (verdict.kind === 'ok') {
      await recordProbeRun(pool, {
        probeName: PROBE_NAMES.AUTH_FLOW,
        verdictKind: VERDICT_KINDS.WITHIN_THRESHOLDS,
        stats: enrichedStats,
      })
      return
    }
    // verdict.kind === 'alert'
    // Dedup: don't re-alert on the same offender set within the
    // dedup window. Same set + counts = same fingerprint = skip.
    // First-time fire OR escalation (counts grew on existing
    // offenders) OR new offender = different fingerprint = fire.
    const fingerprint = offenderFingerprint(stats)
    const prevState = await readDedupState(STATE_FILE)
    const nowMs = Date.now()
    if (
      shouldSuppress({
        fingerprint,
        prevState,
        nowMs,
        windowMs: DEDUP_WINDOW_MS,
      })
    ) {
      logJson('info', 'alert suppressed by dedup', {
        fingerprint,
        prevSentAt: new Date(prevState.sentAtMs).toISOString(),
        dedupWindowMs: DEDUP_WINDOW_MS,
      })
      // BCS-DEF-1-TG R2 WARN#2 closure (2026-05-19): dedup_skip emits
      // one row per channel — Telegram row only if master switch is on
      // (plan §2.6 + §3.3b).
      await recordProbeRun(pool, {
        probeName: PROBE_NAMES.AUTH_FLOW,
        verdictKind: VERDICT_KINDS.DEDUP_SKIP,
        recipientKind: RECIPIENT_KINDS.EMAIL,
        fingerprint,
        stats: enrichedStats,
      })
      if (telegramEnabled) {
        await recordProbeRun(pool, {
          probeName: PROBE_NAMES.AUTH_FLOW,
          verdictKind: VERDICT_KINDS.DEDUP_SKIP,
          recipientKind: RECIPIENT_KINDS.TELEGRAM,
          fingerprint,
          stats: enrichedStats,
        })
      }
      return
    }

    // BCS-DEF-1-TG R1 BLOCKER#3 closure — gather-then-dispatch. Both
    // bodies built BEFORE channel dispatch; each channel runs inside
    // its own try-block, never returns from main(). State file remains
    // email-controlled (RISK-3).
    const telegramBody = buildTelegramBody(stats)

    // CHANNEL 1 — email
    let emailOk = false
    try {
      const sendResult = await tryEmailChannel({ stats, verdict })
      if (sendResult.ok) {
        emailOk = true
        await recordProbeRun(pool, {
          probeName: PROBE_NAMES.AUTH_FLOW,
          verdictKind: VERDICT_KINDS.ALERT_SENT,
          alertSent: true,
          recipientKind: RECIPIENT_KINDS.EMAIL,
          recipientEmail: recipientEmailSnapshot,
          alertEmailId: sendResult.emailId,
          fingerprint,
          stats: enrichedStats,
        })
      } else {
        const isConfigMissing =
          sendResult.error === 'missing_resend_api_key' ||
          sendResult.error === 'missing_alert_email_to'
        await recordProbeRun(pool, {
          probeName: PROBE_NAMES.AUTH_FLOW,
          verdictKind: isConfigMissing
            ? VERDICT_KINDS.CONFIG_MISSING
            : VERDICT_KINDS.ALERT_SEND_FAILED,
          alertSent: false,
          recipientKind: RECIPIENT_KINDS.EMAIL,
          recipientEmail: recipientEmailSnapshot,
          fingerprint,
          stats: enrichedStats,
          errorMessage: sendResult.detail ?? sendResult.error,
        })
      }
    } catch (emailErr) {
      logJson('error', 'tryEmailChannel threw unexpectedly', {
        err: emailErr instanceof Error ? emailErr.message : String(emailErr),
      })
      await recordProbeRun(pool, {
        probeName: PROBE_NAMES.AUTH_FLOW,
        verdictKind: VERDICT_KINDS.ALERT_SEND_FAILED,
        recipientKind: RECIPIENT_KINDS.EMAIL,
        recipientEmail: recipientEmailSnapshot,
        fingerprint,
        stats: enrichedStats,
        errorMessage:
          emailErr instanceof Error ? emailErr.message : String(emailErr),
      })
    }

    if (emailOk) {
      // ALERTS-OBS — advance dedup state ONLY on real send success
      // (paranoia round-1 BLOCKER #5: previously this advanced on
      // missing-key / Resend-outage failures too, silently masking
      // retries). BCS-DEF-1-TG RISK-3: state file remains email-
      // controlled regardless of Telegram outcome.
      await writeDedupState(STATE_FILE, {
        fingerprint,
        sentAtMs: nowMs,
      })
    }

    // CHANNEL 2 — Telegram, runs regardless of email outcome.
    if (telegramEnabled) {
      try {
        await tryTelegramChannel({
          pool,
          telegramBody,
          fingerprint,
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
    // an `error` verdict row BEFORE re-throwing, so the admin page
    // shows the failure instead of stale "last run" data forever.
    await recordProbeRun(pool, {
      probeName: PROBE_NAMES.AUTH_FLOW,
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
  process.argv[1]?.endsWith('auth-flow-alert.mjs')

if (invokedDirectly) {
  main().catch((err) => {
    logJson('error', 'unhandled', {
      error: err instanceof Error ? err.message : String(err),
    })
    process.exit(1)
  })
}
