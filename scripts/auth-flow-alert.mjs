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
import { recordProbeRun, PROBE_NAMES, VERDICT_KINDS } from './lib/probe-runs.mjs'

const WINDOW_MINUTES = Number(process.env.AUTH_FLOW_WINDOW_MINUTES || 60)
const MAX_PER_IP = Number(process.env.AUTH_FLOW_MAX_PER_IP || 50)
const MAX_PER_EMAIL_HASH = Number(process.env.AUTH_FLOW_MAX_PER_EMAIL_HASH || 20)

// Codex review 2026-05-09 — dedup window. The cron timer fires every
// 30 min; a sustained brute-force attack would otherwise produce 48
// identical alert emails per day. With dedup, the operator sees one
// email per unique offender-set per ~4 hours. Tunable via env if
// the operator finds the rate too sparse / too loud.
const DEDUP_WINDOW_MS = Number(
  process.env.AUTH_FLOW_DEDUP_WINDOW_MS || 4 * 60 * 60 * 1000,
)
const STATE_FILE = process.env.AUTH_FLOW_STATE_FILE
  ? resolvePath(process.env.AUTH_FLOW_STATE_FILE)
  : resolvePath('./var/auth-flow-alert-state.json')

const ALERT_EMAIL_TO = process.env.ALERT_EMAIL_TO?.trim() || ''
const EMAIL_FROM =
  process.env.EMAIL_FROM?.trim() || 'LevelChannel <noreply@example.com>'
const SSH_COMMAND_HINT = process.env.SSH_COMMAND_HINT?.trim() || 'ssh <host>'

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

// ALERTS-OBS (2026-05-16) — return contract refactor.
// Caller distinguishes config_missing / send_failed / sent so it can
// (a) advance dedup state ONLY on a real send and (b) record the
// right verdict_kind in probe_runs. Previously this function returned
// undefined on every path, so the caller always advanced dedup
// state — a real bug that silently masked retries on missing-key
// or Resend-outage failures (paranoia round-1 BLOCKER #5).
async function sendAlertEmail({ stats, verdict }) {
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
    return { ok: false, error: 'resend_send_failed', detail: result.error.message }
  }
  logJson('info', 'alert email sent', { to: ALERT_EMAIL_TO, stats, verdict })
  return { ok: true, emailId: result.data?.id ?? null }
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
  // ALERTS-OBS (2026-05-16) — capture env-read snapshot at the top
  // of the run so the probe_runs row carries thresholds AS THEY
  // WERE on this tick, not what the admin process happens to
  // remember (paranoia round-1 BLOCKER #8 closure).
  const capturedThresholds = {
    AUTH_FLOW_WINDOW_MINUTES: WINDOW_MINUTES,
    AUTH_FLOW_MAX_PER_IP: MAX_PER_IP,
    AUTH_FLOW_MAX_PER_EMAIL_HASH: MAX_PER_EMAIL_HASH,
    AUTH_FLOW_DEDUP_WINDOW_MS: DEDUP_WINDOW_MS,
  }
  const recipientEmailSnapshot = ALERT_EMAIL_TO || null
  try {
    const stats = await readWindowStats(pool)
    const verdict = decideVerdict(stats)
    logJson('info', 'verdict', { stats, verdict })
    const enrichedStats = { ...stats, thresholds: capturedThresholds }
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
      await recordProbeRun(pool, {
        probeName: PROBE_NAMES.AUTH_FLOW,
        verdictKind: VERDICT_KINDS.DEDUP_SKIP,
        fingerprint,
        stats: enrichedStats,
      })
      return
    }
    const sendResult = await sendAlertEmail({ stats, verdict })
    if (sendResult.ok) {
      // ALERTS-OBS — advance dedup state ONLY on real send success
      // (paranoia round-1 BLOCKER #5: previously this advanced on
      // missing-key / Resend-outage failures too, silently masking
      // retries).
      await writeDedupState(STATE_FILE, {
        fingerprint,
        sentAtMs: nowMs,
      })
      await recordProbeRun(pool, {
        probeName: PROBE_NAMES.AUTH_FLOW,
        verdictKind: VERDICT_KINDS.ALERT_SENT,
        alertSent: true,
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
        recipientEmail: recipientEmailSnapshot,
        fingerprint,
        stats: enrichedStats,
        errorMessage: sendResult.detail ?? sendResult.error,
      })
    }
  } catch (err) {
    // ALERTS-OBS round-3 WARN #5 closure: top-level catch writes
    // an `error` verdict row BEFORE re-throwing, so the admin page
    // shows the failure instead of stale "last run" data forever.
    await recordProbeRun(pool, {
      probeName: PROBE_NAMES.AUTH_FLOW,
      verdictKind: VERDICT_KINDS.ERROR,
      errorMessage: err instanceof Error ? err.message : String(err),
      stats: { thresholds: capturedThresholds },
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
