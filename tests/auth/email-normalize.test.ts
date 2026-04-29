import { describe, expect, it } from 'vitest'

import { normalizeAccountEmail } from '@/lib/auth/accounts'

describe('lib/auth/accounts.normalizeAccountEmail', () => {
  it('lowercases', () => {
    expect(normalizeAccountEmail('User@Example.COM')).toBe('user@example.com')
  })

  it('trims surrounding whitespace', () => {
    expect(normalizeAccountEmail('  user@example.com  ')).toBe('user@example.com')
  })

  it('combines trim + lowercase', () => {
    expect(normalizeAccountEmail('  User@Example.COM  ')).toBe('user@example.com')
  })

  it('idempotent on already-normalized input', () => {
    const once = normalizeAccountEmail('user@example.com')
    expect(normalizeAccountEmail(once)).toBe(once)
  })
})
