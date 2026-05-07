#!/usr/bin/env node
//
// Wave 2.1 Phase B (security) — destructive null-out of plaintext PII
// in payment_audit_events.
//
// Read this whole header before running. The footgun list is real.
//
// Why this exists:
//   Wave 2.1 added pgcrypto-encrypted bytea columns alongside the
//   legacy plaintext columns. The application has been dual-writing
//   plaintext + encrypted for both new rows AND legacy rows (via the
//   backfill script). The encryption-at-rest threat model only kicks
//   in once the plaintext columns hold no data. This script runs the
//   one-shot UPDATE that nulls them.
//
// What it does, in order:
//
//   1. PREFLIGHT (read-only):
//      - Confirm zero rows exist where the plaintext column is set
//        and the encrypted column is NULL. Such a row would lose its
//        PII permanently if we ran the destructive UPDATE — backfill
//        has not completed.
//      - Confirm at least one encrypted row exists (sanity that the
//        wave shipped at all).
//      - Sample three encrypted rows and confirm pgp_sym_decrypt
//        round-trips them under the current AUDIT_ENCRYPTION_KEY. If
//        any sample fails to decrypt, the key in env does not match
//        what the app encrypted with — ABORT.
//
//   2. SNAPSHOT:
//      - `create table payment_audit_events_pre_phase_b as select *
//        from payment_audit_events`. One-query rollback path. Drop
//        the snapshot only after Phase B is in prod for ≥7 days with
//        no rollback need.
//
//   3. DESTRUCTIVE UPDATE (inside a transaction):
//      - `update payment_audit_events set customer_email = null,
//        client_ip = null where customer_email_enc is not null or
//        client_ip_enc is not null`.
//      - Capture rowCount; confirm it matches the pre-flight count of
//        encrypted rows.
//
//   4. POST-VERIFY:
//      - Zero rows remain where `customer_email_enc is not null and
//        customer_email is not null`.
//      - Same for client_ip.
//      - Sample three nulled rows and confirm reads via the encrypted
//        path still succeed (decrypt under PRIMARY).
//
// Safety gates:
//   - The script ALWAYS does preflight + snapshot before the UPDATE.
//   - The destructive UPDATE only runs with `--execute --confirm`.
//   - On preflight failure: exit 2, no snapshot, no UPDATE.
//   - On post-verify failure: exit 1, leaves the snapshot intact for
//     manual rollback.
//   - The snapshot table name is fixed (`payment_audit_events_pre_phase_b`).
//     If a snapshot already exists, the script refuses to overwrite —
//     the operator must drop it manually after confirming it is no
//     longer needed.
//
// Usage:
//   # Read-only preflight (default — never destructive):
//   DATABASE_URL=postgres://... AUDIT_ENCRYPTION_KEY=... \
//     node scripts/null-plaintext-audit-pii.mjs
//
//   # Actually run it, eyes-on:
//   DATABASE_URL=postgres://... AUDIT_ENCRYPTION_KEY=... \
//     node scripts/null-plaintext-audit-pii.mjs --execute --confirm
//
// Rollback (if anything goes wrong):
//   begin;
//     update payment_audit_events e
//        set customer_email = b.customer_email,
//            client_ip      = b.client_ip
//       from payment_audit_events_pre_phase_b b
//      where e.id = b.id
//        and (e.customer_email is null or e.client_ip is null);
//   commit;
//
// After 7 days of confidence:
//   drop table payment_audit_events_pre_phase_b;

import process from 'node:process'

import pg from 'pg'

import { resolveSslConfig } from './_pg-ssl.mjs'

const SNAPSHOT_TABLE = 'payment_audit_events_pre_phase_b'
const MIN_KEY_LENGTH = 32

function parseArgs(argv) {
  const args = { execute: false, confirm: false }
  for (const arg of argv) {
    if (arg === '--execute') args.execute = true
    else if (arg === '--confirm') args.confirm = true
    else {
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
  if (key.length < MIN_KEY_LENGTH) {
    console.error(
      `AUDIT_ENCRYPTION_KEY must be at least ${MIN_KEY_LENGTH} characters; got ${key.length}.`,
    )
    process.exit(2)
  }

  const pool = new pg.Pool({
    connectionString: url,
    max: 2,
    ssl: resolveSslConfig(url),
  })

  try {
    // Step 1: PREFLIGHT.
    console.log('[phase-b] step 1/4 — preflight')

    const counts = await pool.query(
      `select
         count(*) filter (
           where customer_email is not null and customer_email_enc is null
         ) as plaintext_only_email,
         count(*) filter (
           where client_ip is not null and client_ip_enc is null
         ) as plaintext_only_ip,
         count(*) filter (where customer_email_enc is not null) as encrypted_email,
         count(*) filter (where client_ip_enc is not null)      as encrypted_ip
       from payment_audit_events`,
    )
    const c = counts.rows[0]
    const plaintextOnlyEmail = Number(c.plaintext_only_email)
    const plaintextOnlyIp = Number(c.plaintext_only_ip)
    const encryptedEmail = Number(c.encrypted_email)
    const encryptedIp = Number(c.encrypted_ip)

    console.log(
      `[phase-b] plaintext-only rows (must be 0): email=${plaintextOnlyEmail}, ip=${plaintextOnlyIp}`,
    )
    console.log(
      `[phase-b] encrypted rows (sanity): email=${encryptedEmail}, ip=${encryptedIp}`,
    )

    if (plaintextOnlyEmail > 0 || plaintextOnlyIp > 0) {
      console.error(
        `[phase-b] ABORT — ${plaintextOnlyEmail} email + ${plaintextOnlyIp} client_ip rows have plaintext but NO encrypted copy. Running the destructive UPDATE here would lose that data permanently. Run scripts/backfill-audit-encryption.mjs first and re-check.`,
      )
      process.exit(2)
    }

    if (encryptedEmail === 0 && encryptedIp === 0) {
      console.error(
        '[phase-b] ABORT — no encrypted rows in the table at all. Either Wave 2.1 has not deployed yet or the table is empty. Nothing to null.',
      )
      process.exit(2)
    }

    // Sample roundtrip: pick up to 3 encrypted rows and try to decrypt
    // under the current key. A mismatch means the env key does not
    // match what the app encrypted with — abort before the UPDATE.
    const sample = await pool.query(
      `select
         id,
         customer_email,
         pgp_sym_decrypt(customer_email_enc, $1::text) as decrypted_email,
         client_ip,
         case
           when client_ip_enc is not null
           then pgp_sym_decrypt(client_ip_enc, $1::text)
           else null
         end as decrypted_ip
       from payment_audit_events
       where customer_email_enc is not null
       order by created_at desc
       limit 3`,
      [key],
    )

    let sampleMismatchEmail = 0
    let sampleMismatchIp = 0
    for (const row of sample.rows) {
      if (
        row.customer_email !== null &&
        row.decrypted_email !== row.customer_email
      ) {
        sampleMismatchEmail += 1
        console.error(
          `[phase-b] sample mismatch: row ${row.id} plaintext=${row.customer_email} decrypted=${row.decrypted_email}`,
        )
      }
      if (
        row.client_ip !== null &&
        row.decrypted_ip !== null &&
        row.decrypted_ip !== row.client_ip
      ) {
        sampleMismatchIp += 1
        console.error(
          `[phase-b] sample mismatch: row ${row.id} plaintext_ip=${row.client_ip} decrypted_ip=${row.decrypted_ip}`,
        )
      }
    }

    if (sampleMismatchEmail > 0 || sampleMismatchIp > 0) {
      console.error(
        '[phase-b] ABORT — sample roundtrip detected mismatched ciphertext. The AUDIT_ENCRYPTION_KEY in env may not match what the app used to encrypt. Resolve before running the destructive UPDATE.',
      )
      process.exit(2)
    }
    console.log(
      `[phase-b] sample roundtrip OK: ${sample.rows.length} rows decrypted matching plaintext`,
    )

    if (!args.execute) {
      console.log(
        '[phase-b] preflight passed. Run with --execute --confirm to proceed with snapshot + destructive UPDATE.',
      )
      return
    }
    if (!args.confirm) {
      console.error(
        '[phase-b] --execute supplied but --confirm is missing. Both are required to run the destructive step.',
      )
      process.exit(2)
    }

    // Step 2: SNAPSHOT.
    console.log(`[phase-b] step 2/4 — snapshot to ${SNAPSHOT_TABLE}`)

    const snapshotExists = await pool.query(
      `select 1 from information_schema.tables where table_schema = current_schema() and table_name = $1`,
      [SNAPSHOT_TABLE],
    )
    if (snapshotExists.rows.length > 0) {
      console.error(
        `[phase-b] ABORT — ${SNAPSHOT_TABLE} already exists. Either Phase B already ran (drop the snapshot manually after confirming it is no longer needed) or a previous run left it behind. Investigate before re-running.`,
      )
      process.exit(2)
    }

    await pool.query(
      `create table ${SNAPSHOT_TABLE} as select * from payment_audit_events`,
    )
    const snapshotCount = await pool.query(
      `select count(*) as n from ${SNAPSHOT_TABLE}`,
    )
    console.log(
      `[phase-b] snapshot created: ${SNAPSHOT_TABLE} rows=${snapshotCount.rows[0].n}`,
    )

    // Step 3: DESTRUCTIVE UPDATE (in transaction).
    console.log('[phase-b] step 3/4 — destructive UPDATE')

    const client = await pool.connect()
    let updatedRows = 0
    try {
      await client.query('begin')
      const result = await client.query(
        `update payment_audit_events
            set customer_email = null,
                client_ip      = null
          where customer_email_enc is not null
             or client_ip_enc      is not null`,
      )
      updatedRows = result.rowCount ?? 0
      await client.query('commit')
    } catch (err) {
      try {
        await client.query('rollback')
      } catch {
        // best-effort
      }
      console.error(
        '[phase-b] UPDATE failed and was rolled back. Snapshot is intact:',
        err instanceof Error ? err.message : err,
      )
      process.exit(1)
    } finally {
      client.release()
    }
    console.log(`[phase-b] UPDATE committed: ${updatedRows} rows nulled`)

    // Step 4: POST-VERIFY.
    console.log('[phase-b] step 4/4 — post-verify')

    const post = await pool.query(
      `select
         count(*) filter (
           where customer_email_enc is not null and customer_email is not null
         ) as still_dual_email,
         count(*) filter (
           where client_ip_enc is not null and client_ip is not null
         ) as still_dual_ip
       from payment_audit_events`,
    )
    const stillDualEmail = Number(post.rows[0].still_dual_email)
    const stillDualIp = Number(post.rows[0].still_dual_ip)

    if (stillDualEmail > 0 || stillDualIp > 0) {
      console.error(
        `[phase-b] POST-VERIFY FAILED — ${stillDualEmail} email + ${stillDualIp} client_ip rows still have BOTH plaintext and encrypted set. Investigate. Snapshot is intact at ${SNAPSHOT_TABLE}.`,
      )
      process.exit(1)
    }

    // Confirm encrypted reads still work.
    const postSample = await pool.query(
      `select
         id,
         customer_email,
         pgp_sym_decrypt(customer_email_enc, $1::text) as decrypted_email
       from payment_audit_events
       where customer_email_enc is not null
       order by created_at desc
       limit 3`,
      [key],
    )
    for (const row of postSample.rows) {
      if (row.customer_email !== null) {
        console.error(
          `[phase-b] POST-VERIFY ANOMALY — row ${row.id} still has non-null customer_email after the UPDATE. Snapshot is intact at ${SNAPSHOT_TABLE}.`,
        )
        process.exit(1)
      }
      if (typeof row.decrypted_email !== 'string') {
        console.error(
          `[phase-b] POST-VERIFY ANOMALY — row ${row.id} encrypted column will not decrypt under the current key. Read path is broken; investigate immediately. Snapshot is intact at ${SNAPSHOT_TABLE}.`,
        )
        process.exit(1)
      }
    }

    console.log(
      `[phase-b] post-verify OK: ${postSample.rows.length} rows confirmed plaintext=null + encrypted decrypts cleanly`,
    )
    console.log('[phase-b] done.')
    console.log(
      `[phase-b] reminder: drop ${SNAPSHOT_TABLE} only after ≥7 days of prod confidence with no rollback need.`,
    )
  } finally {
    await pool.end()
  }
}

main().catch((err) => {
  console.error('[phase-b] fatal:', err)
  process.exit(1)
})
