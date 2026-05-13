import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  __resetCalendarEncryptionKeyCache,
  getCalendarEncryptionKey,
  getCalendarEncryptionKeyOld,
} from '@/lib/calendar/encryption'

// BCS-C.1 — pure-function key resolver tests. Mirrors the audit
// encryption test surface. Real pgcrypto roundtrip will land in the
// BCS-D/E integration suite alongside the first writer that actually
// touches teacher_calendar_integrations.access_token_enc.

describe('getCalendarEncryptionKey', () => {
  beforeEach(() => {
    delete process.env.CALENDAR_ENCRYPTION_KEY
    delete process.env.CALENDAR_ENCRYPTION_KEY_OLD
    __resetCalendarEncryptionKeyCache()
  })

  afterEach(() => {
    delete process.env.CALENDAR_ENCRYPTION_KEY
    delete process.env.CALENDAR_ENCRYPTION_KEY_OLD
    __resetCalendarEncryptionKeyCache()
  })

  it('returns null when key is missing in dev', () => {
    expect(
      getCalendarEncryptionKey({
        NODE_ENV: 'development',
      } as NodeJS.ProcessEnv),
    ).toBeNull()
  })

  it('returns null when key is missing in test', () => {
    expect(
      getCalendarEncryptionKey({ NODE_ENV: 'test' } as NodeJS.ProcessEnv),
    ).toBeNull()
  })

  it('throws in production when the key is missing', () => {
    expect(() =>
      getCalendarEncryptionKey({
        NODE_ENV: 'production',
      } as NodeJS.ProcessEnv),
    ).toThrow(/required in production/i)
  })

  it('throws in production when the key is whitespace only', () => {
    expect(() =>
      getCalendarEncryptionKey({
        NODE_ENV: 'production',
        CALENDAR_ENCRYPTION_KEY: '   ',
      } as NodeJS.ProcessEnv),
    ).toThrow(/required in production/i)
  })

  it('throws when the key is shorter than 32 characters', () => {
    expect(() =>
      getCalendarEncryptionKey({
        NODE_ENV: 'development',
        CALENDAR_ENCRYPTION_KEY: 'short-key',
      } as NodeJS.ProcessEnv),
    ).toThrow(/at least 32 characters/i)
    expect(() =>
      getCalendarEncryptionKey({
        NODE_ENV: 'production',
        CALENDAR_ENCRYPTION_KEY: 'short-key',
      } as NodeJS.ProcessEnv),
    ).toThrow(/at least 32 characters/i)
  })

  it('returns the validated key when length meets the floor', () => {
    const key = 'a'.repeat(40)
    expect(
      getCalendarEncryptionKey({
        NODE_ENV: 'production',
        CALENDAR_ENCRYPTION_KEY: key,
      } as NodeJS.ProcessEnv),
    ).toBe(key)
  })

  it('caches result against process.env across calls', () => {
    process.env.CALENDAR_ENCRYPTION_KEY = 'b'.repeat(32)
    const first = getCalendarEncryptionKey()
    expect(first).toBe('b'.repeat(32))

    // Mutating process.env after first call does NOT change the cached
    // result. Reset hook is the explicit way to pick up new values.
    process.env.CALENDAR_ENCRYPTION_KEY = 'c'.repeat(48)
    expect(getCalendarEncryptionKey()).toBe('b'.repeat(32))

    __resetCalendarEncryptionKeyCache()
    expect(getCalendarEncryptionKey()).toBe('c'.repeat(48))
  })

  it('does not cache when called with an explicit env arg', () => {
    const env = {
      NODE_ENV: 'test',
      CALENDAR_ENCRYPTION_KEY: 'd'.repeat(32),
    } as NodeJS.ProcessEnv
    expect(getCalendarEncryptionKey(env)).toBe('d'.repeat(32))
    env.CALENDAR_ENCRYPTION_KEY = 'e'.repeat(32)
    // Same env object identity but content changed; resolver should
    // not have cached the prior value against this env.
    expect(getCalendarEncryptionKey(env)).toBe('e'.repeat(32))
  })
})

describe('getCalendarEncryptionKeyOld', () => {
  beforeEach(() => {
    delete process.env.CALENDAR_ENCRYPTION_KEY
    delete process.env.CALENDAR_ENCRYPTION_KEY_OLD
    __resetCalendarEncryptionKeyCache()
  })

  afterEach(() => {
    delete process.env.CALENDAR_ENCRYPTION_KEY
    delete process.env.CALENDAR_ENCRYPTION_KEY_OLD
    __resetCalendarEncryptionKeyCache()
  })

  it('returns null when not set in any env (dev + prod)', () => {
    // Strict-mirror with audit suite: OLD-key missing is never an
    // error, even in prod (rotation is opt-in).
    expect(
      getCalendarEncryptionKeyOld({
        NODE_ENV: 'development',
      } as NodeJS.ProcessEnv),
    ).toBeNull()
    expect(
      getCalendarEncryptionKeyOld({
        NODE_ENV: 'production',
      } as NodeJS.ProcessEnv),
    ).toBeNull()
  })

  it('returns the validated key when set', () => {
    expect(
      getCalendarEncryptionKeyOld({
        CALENDAR_ENCRYPTION_KEY_OLD: 'x'.repeat(40),
      } as NodeJS.ProcessEnv),
    ).toBe('x'.repeat(40))
  })

  it('throws when the OLD key is below the length floor (length check applies if present)', () => {
    expect(() =>
      getCalendarEncryptionKeyOld({
        CALENDAR_ENCRYPTION_KEY_OLD: 'short',
      } as NodeJS.ProcessEnv),
    ).toThrow(/at least 32 characters/i)
  })

  it('treats whitespace-only OLD key as missing (no throw)', () => {
    expect(
      getCalendarEncryptionKeyOld({
        CALENDAR_ENCRYPTION_KEY_OLD: '   ',
      } as NodeJS.ProcessEnv),
    ).toBeNull()
  })

  it('reset hook clears the OLD-key cache too', () => {
    process.env.CALENDAR_ENCRYPTION_KEY_OLD = 'p'.repeat(32)
    expect(getCalendarEncryptionKeyOld()).toBe('p'.repeat(32))

    process.env.CALENDAR_ENCRYPTION_KEY_OLD = 'q'.repeat(32)
    expect(getCalendarEncryptionKeyOld()).toBe('p'.repeat(32))

    __resetCalendarEncryptionKeyCache()
    expect(getCalendarEncryptionKeyOld()).toBe('q'.repeat(32))

    delete process.env.CALENDAR_ENCRYPTION_KEY_OLD
  })

  it('caches independently of the PRIMARY key', () => {
    // Strict-mirror with audit suite (`caches independently of
    // PRIMARY`). Confirms the two cache slots are not coupled —
    // resetting + dropping OLD does not invalidate PRIMARY, and
    // PRIMARY repopulates from process.env on the next call.
    process.env.CALENDAR_ENCRYPTION_KEY = 'p'.repeat(32)
    process.env.CALENDAR_ENCRYPTION_KEY_OLD = 'o'.repeat(32)
    expect(getCalendarEncryptionKey()).toBe('p'.repeat(32))
    expect(getCalendarEncryptionKeyOld()).toBe('o'.repeat(32))
    // Resetting clears both caches. Important so a rotation that
    // drops OLD mid-deploy doesn't leave stale cache.
    __resetCalendarEncryptionKeyCache()
    delete process.env.CALENDAR_ENCRYPTION_KEY_OLD
    expect(getCalendarEncryptionKeyOld()).toBeNull()
    // PRIMARY is still set — cache populates anew.
    expect(getCalendarEncryptionKey()).toBe('p'.repeat(32))

    delete process.env.CALENDAR_ENCRYPTION_KEY
  })
})
