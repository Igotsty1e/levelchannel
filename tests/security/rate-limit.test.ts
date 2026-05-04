import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  __resetRateLimitsForTesting,
  takeRateLimit,
} from '@/lib/security/rate-limit'

// Unit tests run with no DATABASE_URL → the in-memory fallback is
// exercised. The Postgres path is covered by the integration test in
// tests/integration/security/rate-limit.test.ts.

describe('takeRateLimit (in-memory fallback)', () => {
  const originalDatabaseUrl = process.env.DATABASE_URL

  beforeEach(() => {
    delete process.env.DATABASE_URL
    __resetRateLimitsForTesting()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-29T00:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
    if (originalDatabaseUrl !== undefined) {
      process.env.DATABASE_URL = originalDatabaseUrl
    }
  })

  it('allows up to limit and blocks the rest', async () => {
    const key = `t1:${Math.random()}`
    expect((await takeRateLimit(key, 3, 60_000)).allowed).toBe(true)
    expect((await takeRateLimit(key, 3, 60_000)).allowed).toBe(true)
    expect((await takeRateLimit(key, 3, 60_000)).allowed).toBe(true)
    const blocked = await takeRateLimit(key, 3, 60_000)
    expect(blocked.allowed).toBe(false)
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0)
  })

  it('resets after window passes', async () => {
    const key = `t2:${Math.random()}`
    expect((await takeRateLimit(key, 1, 1000)).allowed).toBe(true)
    expect((await takeRateLimit(key, 1, 1000)).allowed).toBe(false)
    vi.advanceTimersByTime(1500)
    expect((await takeRateLimit(key, 1, 1000)).allowed).toBe(true)
  })

  it('isolates separate keys', async () => {
    const a = `t3a:${Math.random()}`
    const b = `t3b:${Math.random()}`
    expect((await takeRateLimit(a, 1, 60_000)).allowed).toBe(true)
    expect((await takeRateLimit(b, 1, 60_000)).allowed).toBe(true)
    expect((await takeRateLimit(a, 1, 60_000)).allowed).toBe(false)
    expect((await takeRateLimit(b, 1, 60_000)).allowed).toBe(false)
  })

  it('reports remaining quota correctly', async () => {
    const key = `t4:${Math.random()}`
    const first = await takeRateLimit(key, 5, 60_000)
    expect(first.remaining).toBe(4)
    const second = await takeRateLimit(key, 5, 60_000)
    expect(second.remaining).toBe(3)
  })
})
