import { describe, expect, it } from 'vitest'

import {
  TEACHER_INVITE_DEFAULT_TTL_SECONDS,
  getTeacherInviteSecret,
  signInviteToken,
  verifyInviteToken,
  type InvitePayload,
} from '@/lib/auth/teacher-invites'

// SAAS-3+4 TINV.1 sign/verify primitive coverage. Pins:
//  - round-trip sign → verify yields the same payload.
//  - tampered HMAC rejected.
//  - tampered payload rejected (HMAC mismatch).
//  - expired token rejected.
//  - version mismatch rejected.
//  - malformed shape rejected.
//  - non-uuid iid/tid rejected.
//  - env-required-in-production contract.

const TEST_ENV: NodeJS.ProcessEnv = {
  TEACHER_INVITE_SECRET:
    'test-teacher-invite-secret-must-be-32-chars-or-more-aaa',
  NODE_ENV: 'test',
} as unknown as NodeJS.ProcessEnv

const PAYLOAD: InvitePayload = {
  v: 1,
  iid: '550e8400-e29b-41d4-a716-446655440000',
  tid: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
  exp: Math.floor(Date.now() / 1000) + TEACHER_INVITE_DEFAULT_TTL_SECONDS,
}

describe('getTeacherInviteSecret', () => {
  it('returns the trimmed env value when set', () => {
    expect(
      getTeacherInviteSecret({
        TEACHER_INVITE_SECRET: '  abc-secret  ',
        NODE_ENV: 'test',
      } as unknown as NodeJS.ProcessEnv),
    ).toBe('abc-secret')
  })

  it('falls back to dev secret when unset in non-production', () => {
    const out = getTeacherInviteSecret({
      NODE_ENV: 'development',
    } as unknown as NodeJS.ProcessEnv)
    expect(out.length).toBeGreaterThan(0)
    expect(out).toContain('dev')
  })

  it('falls back to dev secret when empty/whitespace in non-production', () => {
    expect(
      getTeacherInviteSecret({
        TEACHER_INVITE_SECRET: '',
        NODE_ENV: 'test',
      } as unknown as NodeJS.ProcessEnv).length,
    ).toBeGreaterThan(0)
    expect(
      getTeacherInviteSecret({
        TEACHER_INVITE_SECRET: '   ',
        NODE_ENV: 'development',
      } as unknown as NodeJS.ProcessEnv).length,
    ).toBeGreaterThan(0)
  })

  it('throws in production when unset', () => {
    expect(() =>
      getTeacherInviteSecret({
        NODE_ENV: 'production',
      } as unknown as NodeJS.ProcessEnv),
    ).toThrow(/TEACHER_INVITE_SECRET is required in production/)
  })

  it('throws in production when empty', () => {
    expect(() =>
      getTeacherInviteSecret({
        TEACHER_INVITE_SECRET: '',
        NODE_ENV: 'production',
      } as unknown as NodeJS.ProcessEnv),
    ).toThrow(/TEACHER_INVITE_SECRET is required in production/)
  })
})

describe('signInviteToken / verifyInviteToken round-trip', () => {
  it('round-trips a valid payload', () => {
    const token = signInviteToken(PAYLOAD, TEST_ENV)
    const back = verifyInviteToken(token, TEST_ENV)
    expect(back).toEqual(PAYLOAD)
  })

  it('produces a two-part dot-separated token (~180 chars order of magnitude)', () => {
    const token = signInviteToken(PAYLOAD, TEST_ENV)
    expect(token.split('.').length).toBe(2)
    expect(token.length).toBeGreaterThan(50)
    expect(token.length).toBeLessThan(400)
  })

  it('uses base64url encoding (no +, /, =)', () => {
    const token = signInviteToken(PAYLOAD, TEST_ENV)
    expect(token).not.toMatch(/[+/=]/)
  })

  it('two signs of the same payload yield byte-identical tokens (deterministic HMAC)', () => {
    const a = signInviteToken(PAYLOAD, TEST_ENV)
    const b = signInviteToken(PAYLOAD, TEST_ENV)
    expect(a).toBe(b)
  })
})

describe('verifyInviteToken rejects tampered tokens', () => {
  it('flipped HMAC byte → null', () => {
    const token = signInviteToken(PAYLOAD, TEST_ENV)
    const [payload, hmac] = token.split('.')
    // Flip the last character of the HMAC to a different base64url char.
    const lastChar = hmac.slice(-1)
    const flipped =
      hmac.slice(0, -1) + (lastChar === 'A' ? 'B' : 'A')
    expect(verifyInviteToken(`${payload}.${flipped}`, TEST_ENV)).toBeNull()
  })

  it('flipped payload byte → null (HMAC mismatch)', () => {
    const token = signInviteToken(PAYLOAD, TEST_ENV)
    const [payload, hmac] = token.split('.')
    const lastChar = payload.slice(-1)
    const flipped =
      payload.slice(0, -1) + (lastChar === 'A' ? 'B' : 'A')
    expect(verifyInviteToken(`${flipped}.${hmac}`, TEST_ENV)).toBeNull()
  })

  it('wrong-secret signature → null', () => {
    const token = signInviteToken(PAYLOAD, TEST_ENV)
    const otherEnv = {
      TEACHER_INVITE_SECRET: 'completely-different-secret-value-aaaaaaaa',
      NODE_ENV: 'test',
    } as unknown as NodeJS.ProcessEnv
    expect(verifyInviteToken(token, otherEnv)).toBeNull()
  })

  it('missing dot separator → null', () => {
    expect(verifyInviteToken('noseparatorhere', TEST_ENV)).toBeNull()
  })

  it('three-part token (extra dot) → null', () => {
    expect(verifyInviteToken('a.b.c', TEST_ENV)).toBeNull()
  })

  it('empty token → null', () => {
    expect(verifyInviteToken('', TEST_ENV)).toBeNull()
  })

  it('non-base64url characters in payload → null', () => {
    expect(verifyInviteToken('!@#$.abc', TEST_ENV)).toBeNull()
  })

  it('non-string token → null', () => {
    expect(
      verifyInviteToken(null as unknown as string, TEST_ENV),
    ).toBeNull()
    expect(
      verifyInviteToken(undefined as unknown as string, TEST_ENV),
    ).toBeNull()
    expect(verifyInviteToken(42 as unknown as string, TEST_ENV)).toBeNull()
  })
})

describe('verifyInviteToken expiry', () => {
  it('rejects exp at exact now', () => {
    const now = Math.floor(Date.now() / 1000)
    const token = signInviteToken({ ...PAYLOAD, exp: now }, TEST_ENV)
    expect(verifyInviteToken(token, TEST_ENV, now)).toBeNull()
  })

  it('rejects exp before now', () => {
    const now = Math.floor(Date.now() / 1000)
    const token = signInviteToken({ ...PAYLOAD, exp: now - 1 }, TEST_ENV)
    expect(verifyInviteToken(token, TEST_ENV, now)).toBeNull()
  })

  it('accepts exp 1s after now', () => {
    const now = Math.floor(Date.now() / 1000)
    const token = signInviteToken({ ...PAYLOAD, exp: now + 1 }, TEST_ENV)
    expect(verifyInviteToken(token, TEST_ENV, now)).toEqual({
      ...PAYLOAD,
      exp: now + 1,
    })
  })

  it('rejects negative exp', () => {
    const token = signInviteToken({ ...PAYLOAD, exp: -1 }, TEST_ENV)
    expect(verifyInviteToken(token, TEST_ENV)).toBeNull()
  })

  it('rejects non-finite exp', () => {
    const badEnv = TEST_ENV
    const badPayload = JSON.stringify({
      v: 1,
      iid: PAYLOAD.iid,
      tid: PAYLOAD.tid,
      exp: 'soon',
    })
    // Hand-craft a token with a malformed exp.
    const payloadEnc = Buffer.from(badPayload, 'utf-8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
    // We sign with the correct secret so HMAC passes but exp validation fails.
    const { createHmac } = require('node:crypto') as typeof import('node:crypto')
    const hmac = createHmac('sha256', getTeacherInviteSecret(badEnv))
      .update(payloadEnc)
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
    expect(verifyInviteToken(`${payloadEnc}.${hmac}`, badEnv)).toBeNull()
  })
})

describe('verifyInviteToken payload validation', () => {
  it('rejects v != 1', () => {
    const token = signInviteToken(
      { ...PAYLOAD, v: 2 as unknown as 1 },
      TEST_ENV,
    )
    expect(verifyInviteToken(token, TEST_ENV)).toBeNull()
  })

  it('rejects invalid iid uuid', () => {
    const token = signInviteToken(
      { ...PAYLOAD, iid: 'not-a-uuid' },
      TEST_ENV,
    )
    expect(verifyInviteToken(token, TEST_ENV)).toBeNull()
  })

  it('rejects invalid tid uuid', () => {
    const token = signInviteToken(
      { ...PAYLOAD, tid: 'not-a-uuid' },
      TEST_ENV,
    )
    expect(verifyInviteToken(token, TEST_ENV)).toBeNull()
  })
})

describe('TEACHER_INVITE_DEFAULT_TTL_SECONDS', () => {
  it('is exactly 7 days', () => {
    expect(TEACHER_INVITE_DEFAULT_TTL_SECONDS).toBe(7 * 24 * 60 * 60)
  })
})
