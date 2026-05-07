import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  __resetAuditEncryptionKeyCache,
  getAuditEncryptionKey,
  getAuditEncryptionKeyOld,
} from '@/lib/audit/encryption'

// Wave 2.1 — pure-function key resolver tests. The real pgcrypto
// roundtrip is exercised in the integration suite (needs Postgres).

describe('getAuditEncryptionKey', () => {
  beforeEach(() => {
    delete process.env.AUDIT_ENCRYPTION_KEY
    delete process.env.AUDIT_ENCRYPTION_KEY_OLD
    __resetAuditEncryptionKeyCache()
  })

  afterEach(() => {
    delete process.env.AUDIT_ENCRYPTION_KEY
    delete process.env.AUDIT_ENCRYPTION_KEY_OLD
    __resetAuditEncryptionKeyCache()
  })

  it('returns null when key is missing in dev', () => {
    expect(
      getAuditEncryptionKey({ NODE_ENV: 'development' } as NodeJS.ProcessEnv),
    ).toBeNull()
  })

  it('returns null when key is missing in test', () => {
    expect(
      getAuditEncryptionKey({ NODE_ENV: 'test' } as NodeJS.ProcessEnv),
    ).toBeNull()
  })

  it('throws in production when the key is missing', () => {
    expect(() =>
      getAuditEncryptionKey({ NODE_ENV: 'production' } as NodeJS.ProcessEnv),
    ).toThrow(/required in production/i)
  })

  it('throws in production when the key is whitespace only', () => {
    expect(() =>
      getAuditEncryptionKey({
        NODE_ENV: 'production',
        AUDIT_ENCRYPTION_KEY: '   ',
      } as NodeJS.ProcessEnv),
    ).toThrow(/required in production/i)
  })

  it('throws when the key is shorter than 32 characters (any env)', () => {
    expect(() =>
      getAuditEncryptionKey({
        NODE_ENV: 'production',
        AUDIT_ENCRYPTION_KEY: 'short-key',
      } as NodeJS.ProcessEnv),
    ).toThrow(/at least 32 characters/i)
    expect(() =>
      getAuditEncryptionKey({
        NODE_ENV: 'development',
        AUDIT_ENCRYPTION_KEY: 'short-key',
      } as NodeJS.ProcessEnv),
    ).toThrow(/at least 32 characters/i)
  })

  it('returns the key when it meets the length requirement', () => {
    const key = 'a'.repeat(64)
    expect(
      getAuditEncryptionKey({
        NODE_ENV: 'production',
        AUDIT_ENCRYPTION_KEY: key,
      } as NodeJS.ProcessEnv),
    ).toBe(key)
  })

  it('caches the result on process.env reads (no double-throw on second call)', () => {
    process.env.AUDIT_ENCRYPTION_KEY = 'b'.repeat(32)
    const first = getAuditEncryptionKey()
    const second = getAuditEncryptionKey()
    expect(first).toBe('b'.repeat(32))
    expect(second).toBe(first)
  })

  it('does not cache when called with an explicit env (test ergonomics)', () => {
    const env: NodeJS.ProcessEnv = {
      NODE_ENV: 'production',
      AUDIT_ENCRYPTION_KEY: 'c'.repeat(32),
    }
    expect(getAuditEncryptionKey(env)).toBe('c'.repeat(32))
    // Mutate the explicit env and verify the new value is read on next call.
    env.AUDIT_ENCRYPTION_KEY = 'd'.repeat(32)
    expect(getAuditEncryptionKey(env)).toBe('d'.repeat(32))
  })
})

describe('getAuditEncryptionKeyOld (Wave 3.1 rotation fallback)', () => {
  beforeEach(() => {
    delete process.env.AUDIT_ENCRYPTION_KEY
    delete process.env.AUDIT_ENCRYPTION_KEY_OLD
    __resetAuditEncryptionKeyCache()
  })

  afterEach(() => {
    delete process.env.AUDIT_ENCRYPTION_KEY
    delete process.env.AUDIT_ENCRYPTION_KEY_OLD
    __resetAuditEncryptionKeyCache()
  })

  it('returns null when not set (any env)', () => {
    expect(
      getAuditEncryptionKeyOld({ NODE_ENV: 'development' } as NodeJS.ProcessEnv),
    ).toBeNull()
    expect(
      getAuditEncryptionKeyOld({ NODE_ENV: 'production' } as NodeJS.ProcessEnv),
    ).toBeNull()
  })

  it('returns the value when set and >= 32 chars', () => {
    expect(
      getAuditEncryptionKeyOld({
        NODE_ENV: 'production',
        AUDIT_ENCRYPTION_KEY_OLD: 'x'.repeat(40),
      } as NodeJS.ProcessEnv),
    ).toBe('x'.repeat(40))
  })

  it('throws when set but < 32 chars (any env, even dev — explicit value is opt-in)', () => {
    expect(() =>
      getAuditEncryptionKeyOld({
        NODE_ENV: 'development',
        AUDIT_ENCRYPTION_KEY_OLD: 'short',
      } as NodeJS.ProcessEnv),
    ).toThrow(/at least 32 characters/i)
  })

  it('treats whitespace-only as not set', () => {
    expect(
      getAuditEncryptionKeyOld({
        NODE_ENV: 'production',
        AUDIT_ENCRYPTION_KEY_OLD: '   ',
      } as NodeJS.ProcessEnv),
    ).toBeNull()
  })

  it('caches independently of the PRIMARY key', () => {
    process.env.AUDIT_ENCRYPTION_KEY = 'p'.repeat(32)
    process.env.AUDIT_ENCRYPTION_KEY_OLD = 'o'.repeat(32)
    expect(getAuditEncryptionKey()).toBe('p'.repeat(32))
    expect(getAuditEncryptionKeyOld()).toBe('o'.repeat(32))
    // Resetting clears both. Important so a rotation that drops OLD
    // mid-deploy doesn't leave stale cache.
    __resetAuditEncryptionKeyCache()
    delete process.env.AUDIT_ENCRYPTION_KEY_OLD
    expect(getAuditEncryptionKeyOld()).toBeNull()
    // PRIMARY is still set — cache populates anew.
    expect(getAuditEncryptionKey()).toBe('p'.repeat(32))
  })
})
