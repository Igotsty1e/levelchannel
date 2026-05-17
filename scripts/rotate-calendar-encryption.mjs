#!/usr/bin/env node
//
// AUDIT-SEC-2 (2026-05-17) — re-encrypt every calendar row from
// CALENDAR_ENCRYPTION_KEY_OLD to CALENDAR_ENCRYPTION_KEY (the new
// PRIMARY). Mirrors scripts/rotate-audit-encryption.mjs, scope is
// the calendar tables.
//
// Tables + encrypted columns covered:
//   - teacher_calendar_integrations.access_token_enc
//   - teacher_calendar_integrations.refresh_token_enc
//   - teacher_external_busy_intervals.summary_encrypted
//
// Run order on the target environment (also in SECURITY.md
// § At-rest encryption — Calendar key rotation):
//   1. Generate a fresh key: `openssl rand -base64 48`.
//   2. Set CALENDAR_ENCRYPTION_KEY = <new>, CALENDAR_ENCRYPTION_KEY_OLD
//      = <previous>. Restart the app. From this moment, NEW token /
//      summary writes encrypt with <new>; reads succeed for both old
//      + new rows via pgp_sym_decrypt_either (lib/calendar/integrations.ts:286,
//      pull-runner.ts summary handling).
//   3. Run THIS script. Per-row: try-decrypt with OLD, re-encrypt
//      with PRIMARY, UPDATE the _enc / _encrypted columns. Idempotent
//      — rows already PRIMARY-encrypted are skipped.
//   4. Verify: zero rows remain decryptable only with OLD (output of
//      the second `countOldOnly` call).
//   5. Drop CALENDAR_ENCRYPTION_KEY_OLD from env. Restart. The
//      rotation window is over.
//
// Failure modes (same as audit-rotation):
//   - per-batch SQL failures are logged and the loop retries up to 3x;
//   - exit 0 if zero OLD-only rows remain;
//   - exit 1 if some rows remain OLD-only after the run (re-run).
//
// Wrong-OLD-key footgun protection (Codex 2026-05-07 lesson, mirrored
// here): the preflight counts rows that PRIMARY alone CANNOT decrypt
// (`needs-rotation`). Those rows MUST equal `countOldOnly` — otherwise
// some rows decrypt under NEITHER key, which means the supplied OLD is
// wrong, OR data was encrypted with a third key. Either way, refuse
// to proceed rather than report "nothing to do" and let the operator
// drop the real OLD key on a still-stale dataset.
//
// Race-safety with the live app:
//   - FOR UPDATE SKIP LOCKED isolates each batch; concurrent
//     INSERT-from-app paths use the new PRIMARY key (never OLD), so
//     a row inserted during rotation is born PRIMARY-only and the
//     script's rotation predicate correctly skips it.

import process from 'node:process'

import pg from 'pg'

import { resolveSslConfig } from './_pg-ssl.mjs'

const DEFAULT_BATCH_SIZE = 1000
const MIN_KEY_LENGTH = 32

// Each entry: (table, encryptedColumn, ageColumn-for-ordering). The
// rotation walks the tables in order and respects per-table batches.
const ROTATION_TARGETS = [
  {
    table: 'teacher_calendar_integrations',
    column: 'access_token_enc',
    ageColumn: 'created_at',
  },
  {
    table: 'teacher_calendar_integrations',
    column: 'refresh_token_enc',
    ageColumn: 'created_at',
  },
  {
    table: 'teacher_external_busy_intervals',
    column: 'summary_encrypted',
    ageColumn: 'fetched_at',
  },
]

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

  const primaryKey = (process.env.CALENDAR_ENCRYPTION_KEY ?? '').trim()
  const oldKey = (process.env.CALENDAR_ENCRYPTION_KEY_OLD ?? '').trim()

  if (primaryKey.length === 0) {
    console.error('CALENDAR_ENCRYPTION_KEY (the new PRIMARY) is not set.')
    process.exit(2)
  }
  if (oldKey.length === 0) {
    console.error(
      'CALENDAR_ENCRYPTION_KEY_OLD is not set. Rotation requires both keys.',
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
      'CALENDAR_ENCRYPTION_KEY and CALENDAR_ENCRYPTION_KEY_OLD are equal — there is nothing to rotate. Set them to different values.',
    )
    process.exit(2)
  }

  // TLS gate: same policy as the app's lib/db/pool.ts. Rotation sends
  // BOTH the new PRIMARY key AND the OLD key as bind parameters to the
  // DB; without strict TLS that's a key-material leak on the wire.
  const pool = new pg.Pool({
    connectionString: url,
    max: 2,
    ssl: resolveSslConfig(url),
  })

  let exitCode = 0
  try {
    for (const target of ROTATION_TARGETS) {
      console.log(`\n[rotate] === ${target.table}.${target.column} ===`)

      const needsRotation = await countNeedsRotation(pool, target, primaryKey)
      const remainingBefore = await countOldOnly(
        pool,
        target,
        primaryKey,
        oldKey,
      )
      console.log(
        `[rotate] rows that PRIMARY alone cannot decrypt: ${needsRotation}`,
      )
      console.log(
        `[rotate] of those, rows that decrypt under the supplied OLD: ${remainingBefore}`,
      )

      const undecipherable = needsRotation - remainingBefore
      if (undecipherable > 0) {
        console.error(
          `[rotate] ABORT — ${undecipherable} rows in ${target.table}.${target.column} are encrypted but decrypt under NEITHER PRIMARY nor the supplied OLD. The supplied CALENDAR_ENCRYPTION_KEY_OLD is likely wrong, or the data was encrypted with a third key. Treating "zero OLD-only rows" as success would brick those rows on the next env cleanup. Re-check both keys before re-running.`,
        )
        exitCode = 2
        // Use a labeled break to leave the for-loop without
        // bypassing the post-finally `process.exit(exitCode)`. The
        // earlier shape used `return` which skipped the explicit
        // exit-code wiring and let Node default to exit 0 — silent
        // mis-classification of the abort. Caught by integration
        // test "refuses to proceed when supplied
        // CALENDAR_ENCRYPTION_KEY_OLD does not decrypt existing
        // rows" (round 1 WARN #3 closure).
        break
      }

      if (needsRotation === 0) {
        console.log(
          `[rotate] nothing to do — all rows on ${target.column} already on PRIMARY.`,
        )
        continue
      }

      if (args.dryRun) {
        console.log(
          `[rotate] --dry-run: would re-encrypt ${needsRotation} rows in ${target.table}.${target.column}.`,
        )
        continue
      }

      let totalUpdated = 0
      let batches = 0
      let failures = 0

      while (true) {
        const updated = await runBatch(
          pool,
          target,
          primaryKey,
          oldKey,
          args.batchSize,
        )
        if (updated === null) {
          failures += 1
          if (failures >= 3) {
            console.error(
              `[rotate] aborting ${target.table}.${target.column}: 3 consecutive batch failures.`,
            )
            exitCode = 1
            break
          }
          continue
        }
        failures = 0

        if (updated === 0) break
        totalUpdated += updated
        batches += 1
        console.log(
          `[rotate] ${target.column} batch ${batches}: re-encrypted ${updated} rows (running total ${totalUpdated})`,
        )
      }

      const remainingAfter = await countOldOnly(
        pool,
        target,
        primaryKey,
        oldKey,
      )
      console.log(
        `[rotate] ${target.column} done. updated=${totalUpdated}, batches=${batches}. remaining OLD-only: ${remainingAfter}`,
      )

      if (remainingAfter > 0) {
        console.warn(
          `[rotate] NON-ZERO remaining for ${target.column}: re-run the script. If the same count persists, investigate.`,
        )
        exitCode = 1
      }
    }
  } finally {
    await pool.end()
  }

  process.exit(exitCode)
}

// "Needs rotation" — the row has the _enc column set AND it does NOT
// decrypt under PRIMARY. Must equal OLD-only when the supplied OLD
// key is correct; the difference is the wrong-OLD-key footgun.
async function countNeedsRotation(pool, target, primaryKey) {
  const result = await pool.query(
    `select count(*)::int as n
       from ${target.table}
      where ${target.column} is not null
        and pgp_sym_decrypt_either(${target.column}, $1, null) is null`,
    [primaryKey],
  )
  return Number(result.rows[0].n)
}

// "OLD only" — the row's _enc column does NOT decrypt under PRIMARY
// but DOES decrypt under OLD.
async function countOldOnly(pool, target, primaryKey, oldKey) {
  const result = await pool.query(
    `select count(*)::int as n
       from ${target.table}
      where ${target.column} is not null
        and pgp_sym_decrypt_either(${target.column}, $1, null) is null
        and pgp_sym_decrypt_either(${target.column}, $2, null) is not null`,
    [primaryKey, oldKey],
  )
  return Number(result.rows[0].n)
}

// Re-encrypt up to `batchSize` rows where the target _enc column
// decrypts under OLD but not under PRIMARY. Only rewrites the ONE
// column being rotated (other encrypted columns on the same row may
// belong to a sibling rotation pass).
async function runBatch(pool, target, primaryKey, oldKey, batchSize) {
  // teacher_calendar_integrations rows are keyed by account_id;
  // teacher_external_busy_intervals by id. We pull the primary key
  // dynamically from information_schema to keep the script
  // table-shape-agnostic at update time.
  const pkColumn = target.table === 'teacher_external_busy_intervals'
    ? 'id'
    : 'account_id'

  try {
    const result = await pool.query(
      `with candidates as (
         select ${pkColumn} as pk from ${target.table} t
          where t.${target.column} is not null
            and pgp_sym_decrypt_either(t.${target.column}, $1, null) is null
            and pgp_sym_decrypt_either(t.${target.column}, $2, null) is not null
          order by ${target.ageColumn} asc
          limit $3
          for update skip locked
       )
       update ${target.table} t
          set ${target.column} = pgp_sym_encrypt(
            pgp_sym_decrypt(t.${target.column}, $2),
            $1
          )
         from candidates
        where t.${pkColumn} = candidates.pk`,
      [primaryKey, oldKey, batchSize],
    )
    return result.rowCount ?? 0
  } catch (err) {
    console.warn(
      `[rotate] ${target.table}.${target.column} batch failed (will retry):`,
      err instanceof Error ? err.message : err,
    )
    return null
  }
}

main().catch((err) => {
  console.error('[rotate] fatal:', err)
  process.exit(1)
})
