#!/usr/bin/env node
//
// Wave 2.1 (security) — one-shot backfill for at-rest encryption
// of payment_audit_events.customer_email + client_ip.
//
// Run order on the target environment:
//   1. Apply migration 0025 (DDL: pgcrypto extension + bytea columns).
//   2. Set AUDIT_ENCRYPTION_KEY in env (32+ random characters).
//   3. Deploy the app — every NEW audit row is now dual-written.
//   4. Run THIS script — backfills _enc columns for legacy rows.
//   5. Verify in Postgres:
//        select count(*) from payment_audit_events
//         where customer_email is not null and customer_email_enc is null;
//      Expect 0 across both columns. If non-zero, re-run.
//   6. (Phase B, separate operator step, no script — because it is the
//      destructive step and should be done with eyes on the dashboard:)
//        update payment_audit_events
//           set customer_email = null, client_ip = null
//         where customer_email_enc is not null
//            or client_ip_enc is not null;
//      After this point the plaintext columns hold no data and the
//      app's read path keeps working via the encrypted column.
//
// Usage:
//   DATABASE_URL=postgres://... AUDIT_ENCRYPTION_KEY=... \
//     node scripts/backfill-audit-encryption.mjs [--batch-size 1000] [--dry-run]
//
// Idempotent: runs many times safely. Each pass only touches rows
// where the relevant *_enc column is still NULL.
//
// Failure mode:
//   - per-batch UPDATE failures are logged and the loop keeps going
//     so a transient blip on row N doesn't block rows N+1...
//   - exit 0 on any progress, exit 1 only if every batch failed.
//
// Why batch UPDATE rather than per-row: the SQL pgp_sym_encrypt runs
// server-side, so a single batch UPDATE per chunk is far cheaper
// than N round-trips for our retention window (~3 years of rows).

import process from 'node:process'

import pg from 'pg'

const DEFAULT_BATCH_SIZE = 1000
const MIN_KEY_LENGTH = 32

function parseArgs(argv) {
  const args = { batchSize: DEFAULT_BATCH_SIZE, dryRun: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--dry-run') {
      args.dryRun = true
    } else if (arg === '--batch-size') {
      const next = argv[i + 1]
      const parsed = Number.parseInt(next ?? '', 10)
      if (!Number.isFinite(parsed) || parsed <= 0) {
        console.error(`Invalid --batch-size: ${next}`)
        process.exit(2)
      }
      args.batchSize = parsed
      i += 1
    } else {
      console.error(`Unknown argument: ${arg}`)
      process.exit(2)
    }
  }
  return args
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  const url = process.env.DATABASE_URL
  if (!url) {
    console.error('DATABASE_URL is not set.')
    process.exit(2)
  }

  const key = (process.env.AUDIT_ENCRYPTION_KEY ?? '').trim()
  if (key.length === 0) {
    console.error('AUDIT_ENCRYPTION_KEY is not set.')
    process.exit(2)
  }
  if (key.length < MIN_KEY_LENGTH) {
    console.error(
      `AUDIT_ENCRYPTION_KEY must be at least ${MIN_KEY_LENGTH} characters; got ${key.length}.`,
    )
    process.exit(2)
  }

  const pool = new pg.Pool({ connectionString: url, max: 2 })

  try {
    const remainingBefore = await countRemaining(pool)
    console.log(
      `[backfill] rows to encrypt: customer_email=${remainingBefore.email}, client_ip=${remainingBefore.ip}`,
    )
    if (remainingBefore.email === 0 && remainingBefore.ip === 0) {
      console.log('[backfill] nothing to do.')
      return
    }

    if (args.dryRun) {
      console.log('[backfill] --dry-run: would encrypt the rows above.')
      return
    }

    let totalUpdated = 0
    let batches = 0
    let failures = 0

    while (true) {
      const updated = await runBatch(pool, key, args.batchSize)
      if (updated === null) {
        failures += 1
        if (failures >= 3) {
          console.error(
            '[backfill] aborting: 3 consecutive batch failures.',
          )
          break
        }
        continue
      }
      failures = 0

      if (updated === 0) break
      totalUpdated += updated
      batches += 1
      console.log(
        `[backfill] batch ${batches}: encrypted ${updated} rows (running total ${totalUpdated})`,
      )
    }

    const remainingAfter = await countRemaining(pool)
    console.log(
      `[backfill] done. updated=${totalUpdated}, batches=${batches}.`,
    )
    console.log(
      `[backfill] remaining: customer_email=${remainingAfter.email}, client_ip=${remainingAfter.ip}`,
    )

    if (remainingAfter.email > 0 || remainingAfter.ip > 0) {
      console.warn(
        '[backfill] NON-ZERO remaining: re-run the script. If the same count persists, investigate.',
      )
      process.exit(1)
    }
  } finally {
    await pool.end()
  }
}

async function countRemaining(pool) {
  const result = await pool.query(
    `select
       count(*) filter (where customer_email is not null and customer_email_enc is null) as email_n,
       count(*) filter (where client_ip is not null and client_ip_enc is null) as ip_n
     from payment_audit_events`,
  )
  return {
    email: Number(result.rows[0].email_n),
    ip: Number(result.rows[0].ip_n),
  }
}

// Encrypts up to `batchSize` rows where ANY of the two _enc columns
// is still NULL but its plaintext sibling has data. Returns the
// number of rows touched (0 means "nothing left to do"), or null on
// SQL failure.
async function runBatch(pool, key, batchSize) {
  try {
    const result = await pool.query(
      `with candidates as (
        select id from payment_audit_events
         where (customer_email is not null and customer_email_enc is null)
            or (client_ip is not null and client_ip_enc is null)
         order by created_at asc
         limit $2
         for update skip locked
      )
      update payment_audit_events e
         set customer_email_enc = case
               when e.customer_email is not null and e.customer_email_enc is null
               then pgp_sym_encrypt(e.customer_email, $1::text)
               else e.customer_email_enc
             end,
             client_ip_enc = case
               when e.client_ip is not null and e.client_ip_enc is null
               then pgp_sym_encrypt(e.client_ip, $1::text)
               else e.client_ip_enc
             end
        from candidates
       where e.id = candidates.id`,
      [key, batchSize],
    )
    return result.rowCount ?? 0
  } catch (err) {
    console.warn(
      '[backfill] batch failed (will retry):',
      err instanceof Error ? err.message : err,
    )
    return null
  }
}

main().catch((err) => {
  console.error('[backfill] fatal:', err)
  process.exit(1)
})
