#!/usr/bin/env node
//
// Daily retention cleanup. One transaction per table — independent
// failures don't roll each other back. Runs as a systemd timer (see
// scripts/systemd/levelchannel-db-retention.{service,timer}); per
// OPERATIONS.md §5 Retention.
//
// Tables and rules:
//
//   account_sessions        — delete where revoked_at is not null
//                             OR expires_at < now() - 7 days
//   email_verifications     — delete where consumed_at is not null
//                             OR expires_at < now() - 30 days
//   password_resets         — delete where consumed_at is not null
//                             OR expires_at < now() - 30 days
//   idempotency_records     — delete where created_at < now() - 7 days
//                             (idempotency window for money-moving
//                             requests is 24h on the wire; 7-day
//                             retention keeps a forensic tail without
//                             unbounded growth)
//   payment_audit_events    — delete where created_at < now() - 3 years
//                             (152-FZ alignment for financial records;
//                             see docs/legal/retention-policy.md §3
//                             when filled in by legal-rf)
//   rate_limit_buckets      — delete where reset_at < now() - 1 hour
//                             (longest current rate-limit window is 60s;
//                             1h grace keeps active buckets safe and
//                             clears the tail otherwise)
//
// What this DOES NOT touch:
//
//   payment_orders          — owned by 54-FZ retention rules (chek/kassa
//                             records ~5 years). Cleanup, if any, lives
//                             in a separate script driven by legal-rf
//                             policy, NOT here.
//   payment_telemetry       — privacy-friendly already (HMAC email +
//                             /24 IP). Retention is product-decision,
//                             not a security gap.
//   accounts / consents     — user-driven (SAR-erasure path), not a
//                             timer's call.
//
// Failure mode: each table delete is wrapped in try/catch. A single
// table's failure logs and moves on; the script exits non-zero only
// if every table failed (network gone). systemd captures the journal
// either way.
//
// Idempotence: every run is a fresh DELETE; running 2x in a row is
// harmless. No state file.

import pg from 'pg'

function logJson(level, msg, extra = {}) {
  console.log(
    JSON.stringify({
      level,
      ts: new Date().toISOString(),
      probe: 'db-retention-cleanup',
      msg,
      ...extra,
    }),
  )
}

async function deleteWindow(pool, label, sql) {
  try {
    const result = await pool.query(sql)
    logJson('info', 'cleaned', { table: label, rows: result.rowCount ?? 0 })
    return { table: label, rows: result.rowCount ?? 0, ok: true }
  } catch (err) {
    logJson('error', 'cleanup failed', {
      table: label,
      error: err instanceof Error ? err.message : String(err),
    })
    return { table: label, rows: 0, ok: false }
  }
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
    const results = await Promise.all([
      deleteWindow(
        pool,
        'account_sessions',
        `delete from account_sessions
          where revoked_at is not null
             or expires_at < now() - interval '7 days'`,
      ),
      deleteWindow(
        pool,
        'email_verifications',
        `delete from email_verifications
          where consumed_at is not null
             or expires_at < now() - interval '30 days'`,
      ),
      deleteWindow(
        pool,
        'password_resets',
        `delete from password_resets
          where consumed_at is not null
             or expires_at < now() - interval '30 days'`,
      ),
      deleteWindow(
        pool,
        'idempotency_records',
        `delete from idempotency_records
          where created_at < now() - interval '7 days'`,
      ),
      deleteWindow(
        pool,
        'payment_audit_events',
        `delete from payment_audit_events
          where created_at < now() - interval '3 years'`,
      ),
      deleteWindow(
        pool,
        'rate_limit_buckets',
        `delete from rate_limit_buckets
          where reset_at < now() - interval '1 hour'`,
      ),
    ])

    const allFailed = results.every((r) => !r.ok)
    if (allFailed) {
      logJson('error', 'all cleanups failed')
      process.exit(1)
    }
  } finally {
    await pool.end()
  }
}

main().catch((err) => {
  logJson('error', 'unhandled', {
    error: err instanceof Error ? err.message : String(err),
  })
  process.exit(1)
})
