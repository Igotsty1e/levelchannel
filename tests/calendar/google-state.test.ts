import { describe, expect, it } from 'vitest'

import { generateOauthState, verifyOauthState } from '@/lib/calendar/google/state'

const SECRET = 's'.repeat(48)
const UUID = '11111111-2222-3333-4444-555555555555'
const FIXED_RANDOM = Buffer.from(
  '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
  'hex',
)
const FIXED_NOW = 1_700_000_000_000

describe('generateOauthState / verifyOauthState', () => {
  it('round-trips for the issuing account', () => {
    const state = generateOauthState({
      accountId: UUID,
      secret: SECRET,
      random: FIXED_RANDOM,
      nowMs: FIXED_NOW,
    })
    const res = verifyOauthState(state, {
      accountId: UUID,
      secret: SECRET,
      nowMs: FIXED_NOW,
    })
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.accountId).toBe(UUID)
      expect(res.issuedAtMs).toBe(FIXED_NOW)
    }
  })

  it('produces a deterministic state for the same inputs', () => {
    const a = generateOauthState({
      accountId: UUID,
      secret: SECRET,
      random: FIXED_RANDOM,
      nowMs: FIXED_NOW,
    })
    const b = generateOauthState({
      accountId: UUID,
      secret: SECRET,
      random: FIXED_RANDOM,
      nowMs: FIXED_NOW,
    })
    expect(a).toBe(b)
  })

  it('rejects malformed state', () => {
    const bad = ['', 'no-dots', 'one.two.three', 'foo.bar.baz.qux.extra']
    for (const s of bad) {
      const r = verifyOauthState(s, { accountId: UUID, secret: SECRET })
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.reason).toBe('malformed')
    }
  })

  it('rejects state issued for a different account', () => {
    const state = generateOauthState({
      accountId: UUID,
      secret: SECRET,
      random: FIXED_RANDOM,
      nowMs: FIXED_NOW,
    })
    const other = '99999999-8888-7777-6666-555555555555'
    const res = verifyOauthState(state, {
      accountId: other,
      secret: SECRET,
      nowMs: FIXED_NOW,
    })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toBe('account_mismatch')
  })

  it('rejects state signed with a different secret', () => {
    const state = generateOauthState({
      accountId: UUID,
      secret: SECRET,
      random: FIXED_RANDOM,
      nowMs: FIXED_NOW,
    })
    const res = verifyOauthState(state, {
      accountId: UUID,
      secret: 'wrong'.repeat(10),
      nowMs: FIXED_NOW,
    })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toBe('bad_signature')
  })

  it('rejects tampered hmac', () => {
    const state = generateOauthState({
      accountId: UUID,
      secret: SECRET,
      random: FIXED_RANDOM,
      nowMs: FIXED_NOW,
    })
    // Flip a character in the last segment (hmac).
    const parts = state.split('.')
    const flipped = parts[3].replace(/[A-Za-z]/, (c) =>
      c === 'A' ? 'B' : 'A',
    )
    const tampered = `${parts[0]}.${parts[1]}.${parts[2]}.${flipped}`
    const res = verifyOauthState(tampered, {
      accountId: UUID,
      secret: SECRET,
      nowMs: FIXED_NOW,
    })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toBe('bad_signature')
  })

  it('rejects expired state past TTL', () => {
    const state = generateOauthState({
      accountId: UUID,
      secret: SECRET,
      random: FIXED_RANDOM,
      nowMs: FIXED_NOW,
    })
    const res = verifyOauthState(state, {
      accountId: UUID,
      secret: SECRET,
      nowMs: FIXED_NOW + 11 * 60 * 1000, // 11 minutes later
      ttlMs: 10 * 60 * 1000,
    })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toBe('expired')
  })

  it('rejects state issued more than 1min in the future (clock skew defense)', () => {
    const state = generateOauthState({
      accountId: UUID,
      secret: SECRET,
      random: FIXED_RANDOM,
      nowMs: FIXED_NOW + 2 * 60 * 1000, // issued 2m in the future
    })
    const res = verifyOauthState(state, {
      accountId: UUID,
      secret: SECRET,
      nowMs: FIXED_NOW,
    })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toBe('malformed')
  })

  it('accepts UUID in mixed case and with/without dashes', () => {
    const dashless = 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE'
    const state = generateOauthState({
      accountId: dashless,
      secret: SECRET,
      random: FIXED_RANDOM,
      nowMs: FIXED_NOW,
    })
    const res = verifyOauthState(state, {
      accountId: dashless.toLowerCase(),
      secret: SECRET,
      nowMs: FIXED_NOW,
    })
    expect(res.ok).toBe(true)
  })

  it('throws on non-UUID accountId at generate time', () => {
    expect(() =>
      generateOauthState({
        accountId: 'not-a-uuid',
        secret: SECRET,
      }),
    ).toThrow(/must be a UUID/)
  })
})
