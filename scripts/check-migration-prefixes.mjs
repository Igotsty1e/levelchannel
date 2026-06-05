#!/usr/bin/env node
// Migration-prefix duplicate check. Prevents future occurrences of the
// 2026-06-02 incident where two PRs (#490 + #492) independently authored
// migrations with the same NNNN prefix and both landed on main without
// renumbering, producing:
//   - migrations/0103_drop_accounts_postpaid_allowed.sql
//   - migrations/0103_teacher_subscription_plans_rename_titles_ru.sql
//
// Post-mortem: docs/post-mortems/2026-06-02-migration-0103-prefix-collision.md
//
// Migration runner (scripts/migrate.mjs) tracks by full filename, so both
// files apply correctly in alphabetical order — no DB corruption. The
// risk is operator confusion: "which migration is 0103?" has no single
// answer. This check fails CI if any NNNN prefix appears more than once.
//
// Usage:
//   node scripts/check-migration-prefixes.mjs        # human-readable
//   node scripts/check-migration-prefixes.mjs --ci   # silent on success

import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')
const MIGRATIONS_DIR = path.join(REPO_ROOT, 'migrations')

const ci = process.argv.includes('--ci')

function log(msg) {
  if (!ci) console.log(msg)
}

// Migration prefix: NNNN (4 digits) + optional single letter suffix
// for intentional sub-numbering within the same slot (e.g. 0076a, 0076c).
// Lettered sub-numbers are treated as DISTINCT prefixes for collision
// detection because they're the operator's deliberate disambiguation.
const PREFIX_RE = /^(\d{4}[a-z]?)_/

function main() {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'))
  const byPrefix = new Map()
  for (const f of files) {
    const m = PREFIX_RE.exec(f)
    if (!m) {
      console.error(`FAIL  migration filename does not match NNNN_ prefix: ${f}`)
      process.exit(1)
    }
    const prefix = m[1]
    if (!byPrefix.has(prefix)) byPrefix.set(prefix, [])
    byPrefix.get(prefix).push(f)
  }

  log('=== migration-prefix duplicate check ===')
  log(`scanned ${files.length} migration files`)
  log(`${byPrefix.size} distinct NNNN prefixes`)

  const collisions = [...byPrefix.entries()].filter(([, names]) => names.length > 1)

  // 2026-06-02 incident: 0103 is the ONLY allowed historical collision.
  // Both files already shipped to main (commits ee14889 + 1fd631e) and
  // applied to prod. Renaming them would require a destructive UPDATE on
  // _migrations and a re-deploy ordering dance; the value isn't worth
  // the operator risk.
  const ALLOWED_HISTORICAL_COLLISIONS = new Set(['0103'])
  const blockingCollisions = collisions.filter(
    ([prefix]) => !ALLOWED_HISTORICAL_COLLISIONS.has(prefix),
  )

  if (blockingCollisions.length === 0) {
    if (collisions.length > 0) {
      log(
        `PASS  no NEW prefix collisions (${collisions.length} grandfathered: ${[...ALLOWED_HISTORICAL_COLLISIONS].join(', ')})`,
      )
    } else {
      log('PASS  no prefix collisions')
    }
    return
  }

  console.error(`FAIL  ${blockingCollisions.length} NEW prefix collision(s):`)
  for (const [prefix, names] of blockingCollisions) {
    console.error(`  prefix ${prefix}:`)
    for (const n of names) console.error(`    - migrations/${n}`)
  }
  console.error('')
  console.error(
    'Each migration must have a unique NNNN prefix. Rebase the newer PR onto the latest main and renumber its migration to the next available prefix.',
  )
  console.error(
    'If a collision is intentional (historical), add the prefix to ALLOWED_HISTORICAL_COLLISIONS in this file with a comment citing the post-mortem.',
  )
  process.exit(1)
}

main()
