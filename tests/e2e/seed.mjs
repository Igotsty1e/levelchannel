#!/usr/bin/env node
// Seed script for Playwright authenticated e2e suite.
//
// Connects to DATABASE_URL, wipes existing e2e fixtures, creates:
//   - learner account (student role, verified email)
//   - teacher account (teacher role, verified email)
//   - admin account (admin role, verified email)
//
// Mints a session for each via the same cookie + sha256-hash contract as
// `lib/auth/sessions.ts:createSession`. Writes `tests/e2e/.fixtures.json`
// with each role's `{email, accountId, cookieValue}` for the spec to read.
//
// Usage:
//   DATABASE_URL=postgres://... node tests/e2e/seed.mjs
//
// Idempotent: re-running clears the previous e2e fixture rows (matched by
// email prefix `e2e-fixture-`) before reseeding.

import { createHash, randomBytes } from 'node:crypto'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const { Pool } = pg

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURE_FILE = resolve(HERE, '.fixtures.json')

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.error('FAIL  DATABASE_URL not set')
  process.exit(2)
}

// Match `lib/auth/tokens.ts` mintToken / hashToken contract exactly.
function mintToken() {
  // lib/auth/tokens.ts uses 32 bytes; base64url encoding.
  const plain = randomBytes(32).toString('base64url')
  const hash = createHash('sha256').update(plain, 'utf8').digest('hex')
  return { plain, hash }
}

// SESSION_TTL_MS = 7 days per lib/auth/sessions.ts
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000

const ROLE_SPECS = [
  { role: 'learner', dbRole: 'student', email: 'e2e-fixture-learner@example.com' },
  { role: 'teacher', dbRole: 'teacher', email: 'e2e-fixture-teacher@example.com' },
  { role: 'admin', dbRole: 'admin', email: 'e2e-fixture-admin@example.com' },
]

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL })
  const out = {}

  try {
    // Clean slate.
    await pool.query(
      `delete from accounts where email like 'e2e-fixture-%@example.com'`,
    )

    for (const spec of ROLE_SPECS) {
      const accountInsert = await pool.query(
        `insert into accounts (email, password_hash, email_verified_at)
         values ($1, 'dummy-not-usable-for-login', now())
         returning id`,
        [spec.email],
      )
      const accountId = String(accountInsert.rows[0].id)

      await pool.query(
        `insert into account_roles (account_id, role) values ($1, $2)`,
        [accountId, spec.dbRole],
      )

      const { plain, hash } = mintToken()
      const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString()
      await pool.query(
        `insert into account_sessions (account_id, token_hash, expires_at)
         values ($1, $2, $3)`,
        [accountId, hash, expiresAt],
      )

      out[spec.role] = {
        accountId,
        email: spec.email,
        cookieValue: plain,
        expiresAt,
      }
      console.log(`  seeded ${spec.role}  accountId=${accountId}`)
    }

    mkdirSync(dirname(FIXTURE_FILE), { recursive: true })
    writeFileSync(
      FIXTURE_FILE,
      JSON.stringify(out, null, 2) + '\n',
      { mode: 0o600 },
    )
    console.log(`  wrote ${FIXTURE_FILE}`)
    console.log('OK  e2e seed complete')
  } finally {
    await pool.end()
  }
}

main().catch((err) => {
  console.error(`FAIL  e2e seed: ${err.message}`)
  process.exit(1)
})
