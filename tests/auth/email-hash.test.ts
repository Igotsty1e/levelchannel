import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { hashEmailForRateLimit, rateLimitScope } from '@/lib/auth/email-hash'

describe('lib/auth/email-hash', () => {
  const originalSecret = process.env.AUTH_RATE_LIMIT_SECRET
  const originalNodeEnv = process.env.NODE_ENV

  beforeEach(() => {
    process.env.AUTH_RATE_LIMIT_SECRET = 'test-auth-rate-limit-secret-32-chars'
    process.env.NODE_ENV = 'test'
  })

  afterEach(() => {
    process.env.AUTH_RATE_LIMIT_SECRET = originalSecret
    process.env.NODE_ENV = originalNodeEnv
  })

  it('hash matches manual HMAC of normalized email', () => {
    const expected = createHmac('sha256', 'test-auth-rate-limit-secret-32-chars')
      .update('user@example.com', 'utf8')
      .digest('hex')
    expect(hashEmailForRateLimit('user@example.com')).toBe(expected)
  })

  it('normalizes email before hashing — case + whitespace', () => {
    const a = hashEmailForRateLimit('USER@example.com')
    const b = hashEmailForRateLimit('user@example.com')
    const c = hashEmailForRateLimit('  user@example.com  ')
    expect(a).toBe(b)
    expect(b).toBe(c)
  })

  it('different emails produce different hashes', () => {
    expect(hashEmailForRateLimit('a@example.com'))
      .not.toBe(hashEmailForRateLimit('b@example.com'))
  })

  it('rateLimitScope produces stable namespaced string', () => {
    const scope = rateLimitScope('login', 'user@example.com')
    expect(scope.startsWith('auth:login:email:')).toBe(true)
    expect(scope.length).toBeGreaterThan('auth:login:email:'.length + 32)
  })

  it('different actions yield different scope prefixes', () => {
    const login = rateLimitScope('login', 'user@example.com')
    const reg = rateLimitScope('register', 'user@example.com')
    const reset = rateLimitScope('reset_request', 'user@example.com')
    expect(new Set([login, reg, reset]).size).toBe(3)
  })

  it('falls back to dev secret when AUTH_RATE_LIMIT_SECRET unset (NODE_ENV != production)', () => {
    delete process.env.AUTH_RATE_LIMIT_SECRET
    process.env.NODE_ENV = 'development'
    // Should not throw
    expect(() => hashEmailForRateLimit('user@example.com')).not.toThrow()
  })

  it('throws when AUTH_RATE_LIMIT_SECRET unset under NODE_ENV=production', () => {
    delete process.env.AUTH_RATE_LIMIT_SECRET
    process.env.NODE_ENV = 'production'
    expect(() => hashEmailForRateLimit('user@example.com')).toThrow(/AUTH_RATE_LIMIT_SECRET/)
  })
})
