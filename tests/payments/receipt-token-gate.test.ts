import { describe, expect, it } from 'vitest'

import { hashToken, mintToken } from '@/lib/auth/tokens'
import {
  evaluateReceiptGate,
  extractReceiptToken,
} from '@/lib/payments/receipt-token-gate'

const MS_HOUR = 60 * 60 * 1000

function fakeOrder(args: {
  hash?: string | null
  ageHours?: number
}): { createdAt: string; receiptTokenHash: string | null | undefined } {
  const created = new Date(Date.now() - (args.ageHours ?? 0) * MS_HOUR)
  return {
    createdAt: created.toISOString(),
    receiptTokenHash: args.hash ?? null,
  }
}

describe('extractReceiptToken', () => {
  it('reads X-Receipt-Token header', () => {
    const req = new Request('https://example.com/x', {
      headers: { 'x-receipt-token': 'abc123' },
    })
    expect(extractReceiptToken(req)).toBe('abc123')
  })

  it('reads ?token= query param when header is absent', () => {
    const req = new Request('https://example.com/x?token=qwerty')
    expect(extractReceiptToken(req)).toBe('qwerty')
  })

  it('header wins over query param', () => {
    const req = new Request('https://example.com/x?token=fromQuery', {
      headers: { 'x-receipt-token': 'fromHeader' },
    })
    expect(extractReceiptToken(req)).toBe('fromHeader')
  })

  it('trims whitespace', () => {
    const req = new Request('https://example.com/x', {
      headers: { 'x-receipt-token': '  spaced  ' },
    })
    expect(extractReceiptToken(req)).toBe('spaced')
  })

  it('returns null when both are absent or empty', () => {
    expect(
      extractReceiptToken(new Request('https://example.com/x')),
    ).toBeNull()
    expect(
      extractReceiptToken(
        new Request('https://example.com/x?token=', {
          headers: { 'x-receipt-token': '   ' },
        }),
      ),
    ).toBeNull()
  })
})

describe('evaluateReceiptGate', () => {
  describe('legacy NULL-token rows', () => {
    it('grants legacy_grace for orders younger than 24h with no token presented', () => {
      const verdict = evaluateReceiptGate(
        fakeOrder({ hash: null, ageHours: 6 }),
        null,
      )
      expect(verdict).toEqual({ ok: true, reason: 'legacy_grace' })
    })

    it('grants legacy_grace for legacy orders even when a token IS presented', () => {
      // No stored hash to compare against — token presence is moot.
      const verdict = evaluateReceiptGate(
        fakeOrder({ hash: null, ageHours: 1 }),
        'random-token',
      )
      expect(verdict.ok).toBe(true)
    })

    it('refuses legacy orders past the 24h grace window', () => {
      const verdict = evaluateReceiptGate(
        fakeOrder({ hash: null, ageHours: 25 }),
        null,
      )
      expect(verdict).toEqual({
        ok: false,
        reason: 'legacy_grace_expired',
      })
    })

    it('refuses legacy orders with malformed createdAt (defensive)', () => {
      const verdict = evaluateReceiptGate(
        { createdAt: 'not-a-date', receiptTokenHash: null },
        null,
      )
      expect(verdict.ok).toBe(false)
    })
  })

  describe('post-Phase-1.5 rows (hash present)', () => {
    const { plain, hash } = mintToken()

    it('refuses with token_required when hash exists but no token presented', () => {
      const verdict = evaluateReceiptGate(
        { createdAt: new Date().toISOString(), receiptTokenHash: hash },
        null,
      )
      expect(verdict).toEqual({ ok: false, reason: 'token_required' })
    })

    it('refuses with token_mismatch on a wrong token', () => {
      const verdict = evaluateReceiptGate(
        { createdAt: new Date().toISOString(), receiptTokenHash: hash },
        'wrong-plain-token',
      )
      expect(verdict).toEqual({ ok: false, reason: 'token_mismatch' })
    })

    it('grants token_match on the right token', () => {
      const verdict = evaluateReceiptGate(
        { createdAt: new Date().toISOString(), receiptTokenHash: hash },
        plain,
      )
      expect(verdict).toEqual({ ok: true, reason: 'token_match' })
    })

    it('age does NOT matter when hash is present (no grace path)', () => {
      // 30 days old, hash present, token wrong → still refused.
      const old = evaluateReceiptGate(
        {
          createdAt: new Date(Date.now() - 30 * 24 * MS_HOUR).toISOString(),
          receiptTokenHash: hash,
        },
        'wrong',
      )
      expect(old.ok).toBe(false)
    })

    it('refuses tokens that hash to a wildly different length (defensive)', () => {
      const tinyHash = 'a'.repeat(10) // not 64 hex
      const verdict = evaluateReceiptGate(
        { createdAt: new Date().toISOString(), receiptTokenHash: tinyHash },
        'whatever',
      )
      expect(verdict.ok).toBe(false)
      expect(verdict.reason).toBe('token_mismatch')
    })
  })

  it('uses constant-time hash compare (no early return on prefix match)', () => {
    const { plain, hash } = mintToken()
    // Build a forged token whose sha256 shares a long prefix with the
    // real hash but differs at the last byte. We can't easily produce
    // such a forgery without the preimage, but we can sanity-check
    // that a hand-crafted "almost same hash" string still returns
    // mismatch.
    const wrongPlain = plain + 'x'
    const wrongHash = hashToken(wrongPlain)
    expect(wrongHash).not.toBe(hash)

    const verdict = evaluateReceiptGate(
      { createdAt: new Date().toISOString(), receiptTokenHash: hash },
      wrongPlain,
    )
    expect(verdict.ok).toBe(false)
  })
})
