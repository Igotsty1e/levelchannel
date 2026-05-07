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
//   webhook_deliveries      — delete where received_at < now() - 90 days
//                             (Wave 1.2 dedup table; 90-day retention
//                             is long enough to debug a production
//                             escalation, short enough to bound disk
//                             pressure as the dedup row count grows
//                             with every webhook over the years)
//   accounts (purge)        — anonymize rows where scheduled_purge_at
//                             <= now() AND purged_at IS NULL. Email
//                             becomes deleted-<uuid>@example.invalid;
//                             password_hash becomes 'PURGED' (no
//                             bcrypt prefix → never matches);
//                             account_profiles row is cleared. The
//                             auth row stays for audit (financial
//                             history needs it under 54-FZ).
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

// Account purge: rows where scheduled_purge_at has elapsed AND we
// haven't already anonymized them. Two updates per row, run inside a
// single transaction per row so a row is never observed half-purged.
//
// Email becomes 'deleted-<uuid>@example.invalid'. The placeholder
// uses the row id (already unique) so the unique-on-email index never
// trips. password_hash becomes 'PURGED' (no bcrypt $2 prefix → no
// possible match on login).
async function purgeAccounts(pool) {
  const label = 'accounts (purge)'
  let purged = 0
  try {
    const candidates = await pool.query(
      `select id from accounts
        where scheduled_purge_at is not null
          and scheduled_purge_at <= now()
          and purged_at is null
        order by scheduled_purge_at asc
        limit 500`,
    )
    for (const row of candidates.rows) {
      const id = String(row.id)
      const client = await pool.connect()
      try {
        await client.query('begin')
        await client.query(
          `update accounts
              set email = 'deleted-' || id::text || '@example.invalid',
                  password_hash = 'PURGED',
                  purged_at = now(),
                  updated_at = now()
            where id = $1
              and purged_at is null`,
          [id],
        )
        await client.query(
          `update account_profiles
              set display_name = null,
                  timezone = null,
                  locale = null,
                  updated_at = now()
            where account_id = $1`,
          [id],
        )
        await client.query('commit')
        purged += 1
      } catch (rowErr) {
        await client.query('rollback').catch(() => {})
        logJson('error', 'account purge failed for row', {
          id,
          error: rowErr instanceof Error ? rowErr.message : String(rowErr),
        })
      } finally {
        client.release()
      }
    }
    logJson('info', 'cleaned', { table: label, rows: purged })
    return { table: label, rows: purged, ok: true }
  } catch (err) {
    logJson('error', 'cleanup failed', {
      table: label,
      error: err instanceof Error ? err.message : String(err),
    })
    return { table: label, rows: purged, ok: false }
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
      // Wave 1.2 webhook delivery dedup. 90-day retention matches the
      // janitor doc on `purgeStaleWebhookDeliveries` in
      // lib/payments/webhook-dedup.ts — long enough to debug a real
      // production escalation, short enough to keep the table small.
      deleteWindow(
        pool,
        'webhook_deliveries',
        `delete from webhook_deliveries
          where received_at < now() - interval '90 days'`,
      ),
      purgeAccounts(pool),
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
