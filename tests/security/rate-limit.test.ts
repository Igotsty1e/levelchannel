import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { takeRateLimit } from '@/lib/security/rate-limit'

describe('takeRateLimit', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-29T00:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('allows up to limit and blocks the rest', () => {
    const key = `t1:${Math.random()}`
    expect(takeRateLimit(key, 3, 60_000).allowed).toBe(true)
    expect(takeRateLimit(key, 3, 60_000).allowed).toBe(true)
    expect(takeRateLimit(key, 3, 60_000).allowed).toBe(true)
    const blocked = takeRateLimit(key, 3, 60_000)
    expect(blocked.allowed).toBe(false)
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0)
  })

  it('resets after window passes', () => {
    const key = `t2:${Math.random()}`
    expect(takeRateLimit(key, 1, 1000).allowed).toBe(true)
    expect(takeRateLimit(key, 1, 1000).allowed).toBe(false)
    vi.advanceTimersByTime(1500)
    expect(takeRateLimit(key, 1, 1000).allowed).toBe(true)
  })

  it('isolates separate keys', () => {
    const a = `t3a:${Math.random()}`
    const b = `t3b:${Math.random()}`
    expect(takeRateLimit(a, 1, 60_000).allowed).toBe(true)
    expect(takeRateLimit(b, 1, 60_000).allowed).toBe(true)
    expect(takeRateLimit(a, 1, 60_000).allowed).toBe(false)
    expect(takeRateLimit(b, 1, 60_000).allowed).toBe(false)
  })

  it('reports remaining quota correctly', () => {
    const key = `t4:${Math.random()}`
    const first = takeRateLimit(key, 5, 60_000)
    expect(first.remaining).toBe(4)
    const second = takeRateLimit(key, 5, 60_000)
    expect(second.remaining).toBe(3)
  })
})
