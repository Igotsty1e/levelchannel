import { afterAll, afterEach, beforeAll } from 'vitest'

import { getAuthPool } from '@/lib/auth/pool'
import { __resetRateLimitsForTesting } from '@/lib/security/rate-limit'

// Per /plan-eng-review D5 — integration tests run against Docker Postgres
// (postgres:16.13, exact prod parity). Brought up by scripts/test-integration.sh
// which sets DATABASE_URL pointing at 127.0.0.1:54329 + runs migrate:up.

beforeAll(async () => {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      'DATABASE_URL must be set for integration tests. Run via npm run test:integration.',
    )
  }
  // Touch the pool to fail fast if Docker is down.
  await getAuthPool().query('select 1')
})

afterEach(async () => {
  // Truncate all auth-domain tables in dependency order. Payment domain
  // is intentionally left alone — these tests don't touch it.
  const pool = getAuthPool()
  await pool.query(`
    truncate table
      account_consents,
      account_sessions,
      email_verifications,
      password_resets,
      account_roles,
      accounts
    restart identity cascade
  `)
  // Reset in-memory and Postgres rate-limit buckets so per-IP and
  // per-email-hash counters don't leak across test cases.
  await __resetRateLimitsForTesting()
})

afterAll(async () => {
  await getAuthPool().end()
})
