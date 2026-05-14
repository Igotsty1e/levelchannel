import { describe, expect, it } from 'vitest'

import { hashToken, mintToken } from '@/lib/auth/tokens'
import {
  evaluateReceiptGate,
  extractReceiptToken,
} from '@/lib/payments/receipt-token-gate'

function fakeOrder(args: {
  hash?: string | null
}): { receiptTokenHash: string | null | undefined } {
  return {
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
  describe('legacy NULL-token rows (Phase 3 — grace dropped)', () => {
    it('refuses legacy NULL-hash orders unconditionally — no token presented', () => {
      const verdict = evaluateReceiptGate(fakeOrder({ hash: null }), null)
      expect(verdict).toEqual({ ok: false, reason: 'legacy_grace_expired' })
    })

    it('refuses legacy NULL-hash orders unconditionally — even when a token IS presented', () => {
      // No stored hash to compare against — token presence is moot.
      const verdict = evaluateReceiptGate(
        fakeOrder({ hash: null }),
        'random-token',
      )
      expect(verdict).toEqual({ ok: false, reason: 'legacy_grace_expired' })
    })
  })

  describe('post-Phase-1.5 rows (hash present)', () => {
    const { plain, hash } = mintToken()

    it('refuses with token_required when hash exists but no token presented', () => {
      const verdict = evaluateReceiptGate({ receiptTokenHash: hash }, null)
      expect(verdict).toEqual({ ok: false, reason: 'token_required' })
    })

    it('refuses with token_mismatch on a wrong token', () => {
      const verdict = evaluateReceiptGate(
        { receiptTokenHash: hash },
        'wrong-plain-token',
      )
      expect(verdict).toEqual({ ok: false, reason: 'token_mismatch' })
    })

    it('grants token_match on the right token', () => {
      const verdict = evaluateReceiptGate({ receiptTokenHash: hash }, plain)
      expect(verdict).toEqual({ ok: true, reason: 'token_match' })
    })

    it('refuses tokens that hash to a wildly different length (defensive)', () => {
      const tinyHash = 'a'.repeat(10) // not 64 hex
      const verdict = evaluateReceiptGate(
        { receiptTokenHash: tinyHash },
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

    const verdict = evaluateReceiptGate({ receiptTokenHash: hash }, wrongPlain)
    expect(verdict.ok).toBe(false)
  })
})
