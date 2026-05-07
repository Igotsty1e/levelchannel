#!/usr/bin/env node
//
// Wave 3.1 (security) — re-encrypt every payment_audit_events row
// from AUDIT_ENCRYPTION_KEY_OLD to AUDIT_ENCRYPTION_KEY (the new
// PRIMARY).
//
// Run order on the target environment (also in SECURITY.md
// § At-rest encryption — Operator-driven key rotation):
//   1. Generate a fresh key: `openssl rand -base64 48`.
//   2. Set AUDIT_ENCRYPTION_KEY = <new>, AUDIT_ENCRYPTION_KEY_OLD =
//      <previous>. Restart the app. From this moment, NEW audit
//      rows are encrypted with <new>; reads succeed for both old +
//      new rows via pgp_sym_decrypt_either.
//   3. Run THIS script. Per-row: try-decrypt with OLD, re-encrypt
//      with PRIMARY, UPDATE both _enc columns. Idempotent — rows
//      already PRIMARY-encrypted are skipped.
//   4. Verify: zero rows remain decryptable only with OLD.
//        select count(*) from payment_audit_events
//          where customer_email_enc is not null
//            and pgp_sym_decrypt_either(customer_email_enc, $1, NULL) is null
//            and pgp_sym_decrypt_either(customer_email_enc, $1, $2) is not null;
//      Expect 0. (Reads same shape for client_ip_enc.)
//   5. Drop AUDIT_ENCRYPTION_KEY_OLD from env. Restart. The
//      rotation window is over.
//
// Failure mode:
//   - per-batch SQL failures are logged and the loop keeps going
//     (skip-locked plus retry next batch);
//   - exit 0 if the verification query returns 0 OLD-only rows;
//   - exit 1 if some rows remain OLD-only after the run (re-run).
//
// Idempotence:
//   - re-running is safe. The rotation predicate is "this row's
//     _enc decrypts under OLD but not under PRIMARY" — already-
//     re-encrypted rows match the inverse, are skipped.
//
// Race-safety with the live app:
//   - FOR UPDATE SKIP LOCKED isolates each batch; concurrent
//     INSERT-from-app paths use the new PRIMARY key (never OLD), so
//     a row that the app inserts during the rotation pass is born
//     PRIMARY-only and the script's rotation predicate correctly
//     skips it.

import process from 'node:process'

import pg from 'pg'

import { resolveSslConfig } from './_pg-ssl.mjs'

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

  const primaryKey = (process.env.AUDIT_ENCRYPTION_KEY ?? '').trim()
  const oldKey = (process.env.AUDIT_ENCRYPTION_KEY_OLD ?? '').trim()

  if (primaryKey.length === 0) {
    console.error('AUDIT_ENCRYPTION_KEY (the new PRIMARY) is not set.')
    process.exit(2)
  }
  if (oldKey.length === 0) {
    console.error(
      'AUDIT_ENCRYPTION_KEY_OLD is not set. Rotation requires both keys.',
    )
    process.exit(2)
  }
  if (primaryKey.length < MIN_KEY_LENGTH || oldKey.length < MIN_KEY_LENGTH) {
    console.error(
      `Both keys must be at least ${MIN_KEY_LENGTH} characters.`,
    )
    process.exit(2)
  }
  if (primaryKey === oldKey) {
    console.error(
      'AUDIT_ENCRYPTION_KEY and AUDIT_ENCRYPTION_KEY_OLD are equal — there is nothing to rotate. Set them to different values.',
    )
    process.exit(2)
  }

  // TLS gate: same policy as the app's lib/db/pool.ts. Rotation
  // sends BOTH the new PRIMARY key AND the OLD key as bind parameters
  // to the DB; without strict TLS that is a key-material leak on the
  // wire. `resolveSslConfig` throws on a remote-host plaintext config
  // in production rather than fall through silently.
  const pool = new pg.Pool({
    connectionString: url,
    max: 2,
    ssl: resolveSslConfig(url),
  })

  try {
    // Preflight against the wrong-OLD-key footgun.
    //
    // Codex 2026-05-07: countOldOnly() alone is insufficient. If the
    // operator supplies the WRONG AUDIT_ENCRYPTION_KEY_OLD (e.g. a dev
    // key in prod, or yesterday's key when the real previous key is
    // two rotations back), every "decrypt under OLD" check fails, and
    // the script reports `nothing to do` and exits 0. The operator
    // then drops the real OLD key from env, and every legacy row is
    // permanently bricked.
    //
    // Defense: count rows that the PRIMARY alone cannot decrypt
    // (`needs-rotation`). Those rows MUST equal `countOldOnly` —
    // otherwise some rows decrypt under neither key, which means
    // either the OLD key is wrong, OR the data was encrypted with a
    // third key we don't know about. Either way, refuse to proceed.
    const needsRotation = await countNeedsRotation(pool, primaryKey)
    const remainingBefore = await countOldOnly(pool, primaryKey, oldKey)
    console.log(
      `[rotate] rows that PRIMARY alone cannot decrypt: customer_email=${needsRotation.email}, client_ip=${needsRotation.ip}`,
    )
    console.log(
      `[rotate] of those, rows that decrypt under the supplied OLD: customer_email=${remainingBefore.email}, client_ip=${remainingBefore.ip}`,
    )

    const undecipherableEmail = needsRotation.email - remainingBefore.email
    const undecipherableIp = needsRotation.ip - remainingBefore.ip
    if (undecipherableEmail > 0 || undecipherableIp > 0) {
      console.error(
        `[rotate] ABORT — ${undecipherableEmail} email + ${undecipherableIp} client_ip rows are encrypted but decrypt under NEITHER PRIMARY nor the supplied OLD. The supplied AUDIT_ENCRYPTION_KEY_OLD is likely wrong, or the data was encrypted with a third key. Treating "zero OLD-only rows" as success here would brick those rows on the next env cleanup. Re-check both keys before re-running.`,
      )
      process.exit(2)
    }

    if (needsRotation.email === 0 && needsRotation.ip === 0) {
      console.log('[rotate] nothing to do — all rows already on PRIMARY.')
      return
    }

    if (args.dryRun) {
      console.log('[rotate] --dry-run: would re-encrypt the rows above.')
      return
    }

    let totalUpdated = 0
    let batches = 0
    let failures = 0

    while (true) {
      const updated = await runBatch(pool, primaryKey, oldKey, args.batchSize)
      if (updated === null) {
        failures += 1
        if (failures >= 3) {
          console.error(
            '[rotate] aborting: 3 consecutive batch failures.',
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
        `[rotate] batch ${batches}: re-encrypted ${updated} rows (running total ${totalUpdated})`,
      )
    }

    const remainingAfter = await countOldOnly(pool, primaryKey, oldKey)
    console.log(
      `[rotate] done. updated=${totalUpdated}, batches=${batches}.`,
    )
    console.log(
      `[rotate] remaining OLD-only: customer_email=${remainingAfter.email}, client_ip=${remainingAfter.ip}`,
    )

    if (remainingAfter.email > 0 || remainingAfter.ip > 0) {
      console.warn(
        '[rotate] NON-ZERO remaining: re-run the script. If the same count persists, investigate.',
      )
      process.exit(1)
    }
  } finally {
    await pool.end()
  }
}

// "Needs rotation" predicate: the row has an _enc column that does
// NOT decrypt under PRIMARY. The set MUST equal countOldOnly when the
// supplied OLD key is correct; the gap between the two is the wrong-
// OLD-key footgun the rotate preflight refuses to step on.
async function countNeedsRotation(pool, primaryKey) {
  const result = await pool.query(
    `select
       count(*) filter (
         where customer_email_enc is not null
           and pgp_sym_decrypt_either(customer_email_enc, $1, null) is null
       ) as email_n,
       count(*) filter (
         where client_ip_enc is not null
           and pgp_sym_decrypt_either(client_ip_enc, $1, null) is null
       ) as ip_n
     from payment_audit_events`,
    [primaryKey],
  )
  return {
    email: Number(result.rows[0].email_n),
    ip: Number(result.rows[0].ip_n),
  }
}

// "OLD only" predicate: the row exists, has an _enc column, decrypts
// under OLD, but does NOT decrypt under PRIMARY. Implemented via the
// pgp_sym_decrypt_either helper (migration 0027).
async function countOldOnly(pool, primaryKey, oldKey) {
  const result = await pool.query(
    `select
       count(*) filter (
         where customer_email_enc is not null
           and pgp_sym_decrypt_either(customer_email_enc, $1, null) is null
           and pgp_sym_decrypt_either(customer_email_enc, $2, null) is not null
       ) as email_n,
       count(*) filter (
         where client_ip_enc is not null
           and pgp_sym_decrypt_either(client_ip_enc, $1, null) is null
           and pgp_sym_decrypt_either(client_ip_enc, $2, null) is not null
       ) as ip_n
     from payment_audit_events`,
    [primaryKey, oldKey],
  )
  return {
    email: Number(result.rows[0].email_n),
    ip: Number(result.rows[0].ip_n),
  }
}

// Re-encrypt up to `batchSize` rows where AT LEAST ONE of the two
// _enc columns decrypts under OLD but not under PRIMARY. Per-row,
// rewrite both columns IF either was OLD-encrypted. Already-PRIMARY
// columns pass through their existing ciphertext untouched.
async function runBatch(pool, primaryKey, oldKey, batchSize) {
  try {
    const result = await pool.query(
      `with candidates as (
         select id from payment_audit_events e
          where (
            e.customer_email_enc is not null
            and pgp_sym_decrypt_either(e.customer_email_enc, $1, null) is null
            and pgp_sym_decrypt_either(e.customer_email_enc, $2, null) is not null
          ) or (
            e.client_ip_enc is not null
            and pgp_sym_decrypt_either(e.client_ip_enc, $1, null) is null
            and pgp_sym_decrypt_either(e.client_ip_enc, $2, null) is not null
          )
          order by created_at asc
          limit $3
          for update skip locked
       )
       update payment_audit_events e
          set customer_email_enc = case
                when e.customer_email_enc is not null
                 and pgp_sym_decrypt_either(e.customer_email_enc, $1, null) is null
                 and pgp_sym_decrypt_either(e.customer_email_enc, $2, null) is not null
                then pgp_sym_encrypt(pgp_sym_decrypt(e.customer_email_enc, $2), $1)
                else e.customer_email_enc
              end,
              client_ip_enc = case
                when e.client_ip_enc is not null
                 and pgp_sym_decrypt_either(e.client_ip_enc, $1, null) is null
                 and pgp_sym_decrypt_either(e.client_ip_enc, $2, null) is not null
                then pgp_sym_encrypt(pgp_sym_decrypt(e.client_ip_enc, $2), $1)
                else e.client_ip_enc
              end
         from candidates
        where e.id = candidates.id`,
      [primaryKey, oldKey, batchSize],
    )
    return result.rowCount ?? 0
  } catch (err) {
    console.warn(
      '[rotate] batch failed (will retry):',
      err instanceof Error ? err.message : err,
    )
    return null
  }
}

main().catch((err) => {
  console.error('[rotate] fatal:', err)
  process.exit(1)
})
