#!/usr/bin/env node
//
// AUDIT-SEC-4 Phase B (2026-05-17) — destructive null-out of plaintext
// channel_token in teacher_calendar_integrations.
//
// Read this whole header before running. The footgun list is real.
//
// Why this exists:
//   AUDIT-SEC-4 (migration 0054 + the matching app changes) added a
//   bytea channel_token_enc column alongside the legacy plaintext
//   channel_token. The renewer dual-writes both columns; the webhook
//   reads decrypt-aware with plaintext fallback. The encryption-at-rest
//   threat model only kicks in once the plaintext column holds no data.
//   This script runs the one-shot UPDATE that nulls it, AFTER verifying
//   that every encrypted row round-trips back to the live plaintext.
//
// What it does, in order:
//
//   1. PREFLIGHT (read-only):
//      - Confirm zero rows exist where channel_token is set and
//        channel_token_enc is null. Such a row would lose its
//        verification secret permanently if we ran the destructive
//        UPDATE — Phase A dual-write has not covered it yet (the
//        renewer cycles every ~5 days and will re-encrypt on the next
//        renewal; you can also force-renew via
//        renewExpiringChannels).
//      - Confirm at least one encrypted row exists (sanity that
//        Phase A landed at all).
//      - Sample up to 3 dual-write rows (both columns set), decrypt
//        channel_token_enc under CALENDAR_ENCRYPTION_KEY, and compare
//        equal to channel_token. If any sample mismatches, the env
//        key does not match what the app encrypted with → ABORT.
//
//   2. SNAPSHOT:
//      - `create table teacher_calendar_integrations_pre_sec4_phase_b
//        as select * from teacher_calendar_integrations`. One-query
//        rollback path. Drop the snapshot only after Phase B is in
//        prod for ≥7 days with no rollback need.
//
//   3. DESTRUCTIVE UPDATE (inside a transaction):
//      - `update teacher_calendar_integrations set channel_token = null
//        where channel_token is not null and channel_token_enc is not
//        null`.
//      - Capture rowCount; confirm it matches the preflight count of
//        dual-write rows.
//
//   4. POST-VERIFY:
//      - Zero rows remain where `channel_token_enc is not null AND
//        channel_token is not null`.
//      - Sample up to 3 nulled rows and confirm reads via the
//        encrypted path still succeed (decrypt under PRIMARY).
//
// Safety gates (same shape as scripts/null-plaintext-audit-pii.mjs):
//   - The script ALWAYS does preflight + snapshot before the UPDATE.
//   - The destructive UPDATE only runs with `--execute --confirm`.
//   - On preflight failure: exit 2, no snapshot, no UPDATE.
//   - On post-verify failure: exit 1, leaves the snapshot intact for
//     manual rollback.
//   - The snapshot table name is fixed
//     (`teacher_calendar_integrations_pre_sec4_phase_b`). If it
//     already exists, the script refuses to overwrite.
//
// One-way door:
//   After this script COMMITS, rollback to a pre-Phase-A build is
//   unsafe. The pre-Phase-A webhook reads only plaintext
//   channel_token (it doesn't know about channel_token_enc), so it
//   would silent-drop every push notification on the nulled rows.
//   Run Phase B ONLY after the rollback window has closed.
//
// Usage:
//   # Read-only preflight (default — never destructive):
//   DATABASE_URL=postgres://... CALENDAR_ENCRYPTION_KEY=... \
//     node scripts/null-plaintext-channel-token.mjs
//
//   # Actually run it, eyes-on:
//   DATABASE_URL=postgres://... CALENDAR_ENCRYPTION_KEY=... \
//     node scripts/null-plaintext-channel-token.mjs --execute --confirm
//
// Rollback (if anything goes wrong):
//   begin;
//     update teacher_calendar_integrations t
//        set channel_token = b.channel_token
//       from teacher_calendar_integrations_pre_sec4_phase_b b
//      where t.account_id = b.account_id
//        and t.channel_token is null;
//   commit;
//
// After 7 days of confidence:
//   drop table teacher_calendar_integrations_pre_sec4_phase_b;

import process from 'node:process'

import pg from 'pg'

import { resolveSslConfig } from './_pg-ssl.mjs'

const SNAPSHOT_TABLE = 'teacher_calendar_integrations_pre_sec4_phase_b'
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

  const key = (process.env.CALENDAR_ENCRYPTION_KEY ?? '').trim()
  if (key.length < MIN_KEY_LENGTH) {
    console.error(
      `CALENDAR_ENCRYPTION_KEY must be at least ${MIN_KEY_LENGTH} characters; got ${key.length}.`,
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
           where channel_token is not null and channel_token_enc is null
         ) as plaintext_only,
         count(*) filter (
           where channel_token is not null and channel_token_enc is not null
         ) as dual_write,
         count(*) filter (
           where channel_token is null and channel_token_enc is not null
         ) as encrypted_only
       from teacher_calendar_integrations`,
    )
    const c = counts.rows[0]
    const plaintextOnly = Number(c.plaintext_only)
    const dualWrite = Number(c.dual_write)
    const encryptedOnly = Number(c.encrypted_only)

    console.log(
      `[phase-b] plaintext-only rows (must be 0): ${plaintextOnly}`,
    )
    console.log(
      `[phase-b] dual-write rows (to be nulled): ${dualWrite}`,
    )
    console.log(
      `[phase-b] encrypted-only rows (already Phase B for these): ${encryptedOnly}`,
    )

    if (plaintextOnly > 0) {
      console.error(
        `[phase-b] ABORT — ${plaintextOnly} rows have plaintext channel_token but NO encrypted copy. Running the destructive UPDATE here would lose those verification secrets permanently. Phase A dual-write has not covered these rows; the renewer will dual-write them on the next channel-renewal cycle (every ~5 days), or force a renewal via renewExpiringChannels. Re-check after.`,
      )
      process.exit(2)
    }

    if (dualWrite === 0 && encryptedOnly === 0) {
      console.error(
        '[phase-b] ABORT — no encrypted rows at all. Either Phase A has not deployed yet or no integration has gone through a channel-renewal cycle. Nothing to null.',
      )
      process.exit(2)
    }

    if (dualWrite === 0) {
      console.log(
        '[phase-b] no dual-write rows — nothing to null. Phase B is a no-op on the current dataset.',
      )
      return
    }

    // Sample roundtrip: pick up to 3 dual-write rows and try to
    // decrypt under the current key. A mismatch means the env key
    // does not match what the app encrypted with — abort before any
    // destructive step.
    const sample = await pool.query(
      `select account_id,
              channel_token,
              pgp_sym_decrypt(channel_token_enc, $1::text) as decrypted
         from teacher_calendar_integrations
        where channel_token is not null
          and channel_token_enc is not null
        order by updated_at desc
        limit 3`,
      [key],
    )

    let sampleMismatch = 0
    for (const row of sample.rows) {
      if (row.decrypted !== row.channel_token) {
        sampleMismatch += 1
        console.error(
          `[phase-b] sample mismatch: account_id=${row.account_id} plaintext=<redacted len=${String(row.channel_token).length}> decrypted=<redacted len=${row.decrypted ? String(row.decrypted).length : 'null'}>`,
        )
      }
    }

    if (sampleMismatch > 0) {
      console.error(
        '[phase-b] ABORT — sample roundtrip detected mismatched ciphertext. The CALENDAR_ENCRYPTION_KEY in env may not match what the app used to encrypt. Resolve before running the destructive UPDATE.',
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
      `create table ${SNAPSHOT_TABLE} as select * from teacher_calendar_integrations`,
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
        `update teacher_calendar_integrations
            set channel_token = null
          where channel_token is not null
            and channel_token_enc is not null`,
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
      `select count(*) filter (
         where channel_token_enc is not null and channel_token is not null
       ) as still_dual
       from teacher_calendar_integrations`,
    )
    const stillDual = Number(post.rows[0].still_dual)

    if (stillDual > 0) {
      console.error(
        `[phase-b] POST-VERIFY FAILED — ${stillDual} rows still have BOTH plaintext and encrypted set. Investigate. Snapshot is intact at ${SNAPSHOT_TABLE}.`,
      )
      process.exit(1)
    }

    // Confirm encrypted reads still work.
    const postSample = await pool.query(
      `select account_id,
              channel_token,
              pgp_sym_decrypt(channel_token_enc, $1::text) as decrypted
         from teacher_calendar_integrations
        where channel_token_enc is not null
        order by updated_at desc
        limit 3`,
      [key],
    )
    for (const row of postSample.rows) {
      if (row.channel_token !== null) {
        console.error(
          `[phase-b] POST-VERIFY ANOMALY — account_id ${row.account_id} still has non-null channel_token after the UPDATE. Snapshot is intact at ${SNAPSHOT_TABLE}.`,
        )
        process.exit(1)
      }
      if (typeof row.decrypted !== 'string' || row.decrypted.length === 0) {
        console.error(
          `[phase-b] POST-VERIFY ANOMALY — account_id ${row.account_id} encrypted column will not decrypt under the current key. Read path is broken; investigate immediately. Snapshot is intact at ${SNAPSHOT_TABLE}.`,
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
