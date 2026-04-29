import bcrypt from 'bcryptjs'
import { describe, expect, it } from 'vitest'

import {
  hashPassword,
  passwordNeedsRehash,
  verifyPassword,
} from '@/lib/auth/password'

describe('lib/auth/password', () => {
  it('hashes a password to a non-trivial bcrypt string', async () => {
    const hash = await hashPassword('correct horse battery staple')
    expect(hash).toMatch(/^\$2[aby]\$/)
    expect(hash.length).toBeGreaterThan(50)
  })

  it('verifies the original password', async () => {
    const hash = await hashPassword('correct horse battery staple')
    await expect(verifyPassword('correct horse battery staple', hash)).resolves.toBe(true)
  })

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('correct horse battery staple')
    await expect(verifyPassword('wrong password', hash)).resolves.toBe(false)
  })

  it('rejects when hash is empty (defensive guard)', async () => {
    await expect(verifyPassword('whatever', '')).resolves.toBe(false)
  })
})

describe('passwordNeedsRehash', () => {
  it('returns false for a fresh current-cost hash', async () => {
    const hash = await hashPassword('something')
    expect(passwordNeedsRehash(hash)).toBe(false)
  })

  it('returns true for a legacy lower-cost bcrypt hash', async () => {
    // Legacy cost=10 hash. Bump to 12 (current) → should rehash.
    const legacy = await bcrypt.hash('something', 10)
    expect(passwordNeedsRehash(legacy)).toBe(true)
  })

  it('returns false for an empty hash (no-op rather than spurious upgrade)', () => {
    expect(passwordNeedsRehash('')).toBe(false)
  })

  it('returns true for an unrecognized hash format (forces upgrade post-migration)', () => {
    // Simulates a future format we haven't taught the regex about.
    // Returning true means "rehash on next login" — exactly the
    // behaviour we want when migrating to argon2id, *provided we
    // update the regex at the same time so current hashes don't
    // erroneously rehash on every login*.
    expect(passwordNeedsRehash('$argon2id$v=19$m=...$<hash>')).toBe(true)
    expect(passwordNeedsRehash('plaintext')).toBe(true)
  })

  it('handles all three bcrypt prefixes ($2a$, $2b$, $2y$)', () => {
    expect(passwordNeedsRehash('$2a$12$' + 'x'.repeat(53))).toBe(false)
    expect(passwordNeedsRehash('$2b$12$' + 'x'.repeat(53))).toBe(false)
    expect(passwordNeedsRehash('$2y$12$' + 'x'.repeat(53))).toBe(false)
    expect(passwordNeedsRehash('$2b$10$' + 'x'.repeat(53))).toBe(true)
  })
})
