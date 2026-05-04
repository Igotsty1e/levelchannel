import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { getDbPool } from '@/lib/db/pool'
import { takeRateLimit } from '@/lib/security/rate-limit'

// Real-Postgres integration test for the shared-store rate limiter.
// Verifies:
//   - migration 0016 is applied (table reachable)
//   - the atomic upsert correctly counts / blocks under a single key
//   - hitting the cap returns allowed=false with retryAfter > 0
//   - separate keys do not interfere
//   - a fresh key after a deliberately-stale row resets the count
//
// Each test uses a unique key (timestamp + random) so cases never
// collide and we don't have to truncate the table between runs.

const SUITE = `it_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

beforeAll(async () => {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      'DATABASE_URL must be set for integration tests. Run via npm run test:integration.',
    )
  }
  await getDbPool().query('select 1 from rate_limit_buckets limit 0')
})

afterAll(async () => {
  // Clean up any rows this suite created so a developer running
  // tests repeatedly against a long-lived DB doesn't accumulate junk.
  const pool = getDbPool()
  await pool.query(
    `delete from rate_limit_buckets where bucket_key like $1`,
    [`${SUITE}:%`],
  )
  await pool.end()
})

describe('takeRateLimit (postgres-backed)', () => {
  it('allows up to limit and blocks the rest', async () => {
    const key = `${SUITE}:cap`
    expect((await takeRateLimit(key, 3, 60_000)).allowed).toBe(true)
    expect((await takeRateLimit(key, 3, 60_000)).allowed).toBe(true)
    expect((await takeRateLimit(key, 3, 60_000)).allowed).toBe(true)
    const blocked = await takeRateLimit(key, 3, 60_000)
    expect(blocked.allowed).toBe(false)
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0)
  })

  it('isolates separate keys', async () => {
    const a = `${SUITE}:iso-a`
    const b = `${SUITE}:iso-b`
    expect((await takeRateLimit(a, 1, 60_000)).allowed).toBe(true)
    expect((await takeRateLimit(b, 1, 60_000)).allowed).toBe(true)
    expect((await takeRateLimit(a, 1, 60_000)).allowed).toBe(false)
    expect((await takeRateLimit(b, 1, 60_000)).allowed).toBe(false)
  })

  it('reports remaining quota correctly', async () => {
    const key = `${SUITE}:rem`
    const first = await takeRateLimit(key, 5, 60_000)
    expect(first.remaining).toBe(4)
    const second = await takeRateLimit(key, 5, 60_000)
    expect(second.remaining).toBe(3)
  })

  it('refreshes the bucket when the existing row is past reset_at', async () => {
    const key = `${SUITE}:reset`
    // Seed a stale row directly (reset_at in the past) so the next
    // takeRateLimit sees an expired window and starts a new one.
    await getDbPool().query(
      `insert into rate_limit_buckets (bucket_key, count, reset_at)
       values ($1, 99, now() - interval '1 hour')`,
      [key],
    )
    const fresh = await takeRateLimit(key, 5, 60_000)
    expect(fresh.allowed).toBe(true)
    expect(fresh.remaining).toBe(4)
  })
})
