import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'

import { hashToken, isExpired, mintToken } from '@/lib/auth/tokens'

describe('lib/auth/tokens', () => {
  it('mints a base64url plain token plus its sha256 hash', () => {
    const { plain, hash } = mintToken()
    expect(plain).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(plain.length).toBeGreaterThanOrEqual(40)

    const expectedHash = createHash('sha256').update(plain, 'utf8').digest('hex')
    expect(hash).toBe(expectedHash)
  })

  it('produces distinct tokens across calls', () => {
    const a = mintToken()
    const b = mintToken()
    expect(a.plain).not.toBe(b.plain)
    expect(a.hash).not.toBe(b.hash)
  })

  it('hashToken is deterministic', () => {
    expect(hashToken('hello')).toBe(hashToken('hello'))
    expect(hashToken('hello')).not.toBe(hashToken('hello!'))
  })

  it('isExpired returns true for past timestamps', () => {
    expect(isExpired(new Date(Date.now() - 1000).toISOString())).toBe(true)
  })

  it('isExpired returns false for near-future timestamps', () => {
    expect(isExpired(new Date(Date.now() + 60_000).toISOString())).toBe(false)
  })

  it('isExpired returns true for invalid date strings', () => {
    expect(isExpired('not-a-date')).toBe(true)
  })
})
