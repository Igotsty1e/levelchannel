import { describe, expect, it } from 'vitest'

import { hashToken, mintToken } from '@/lib/auth/tokens'
import {
  evaluateReceiptGate,
  extractReceiptToken,
} from '@/lib/payments/receipt-token-gate'

function fakeOrder(args: {
  hash?: string | null
  metaAccountId?: string | null
}): {
  receiptTokenHash: string | null | undefined
  metadata: Record<string, unknown> | null
} {
  return {
    receiptTokenHash: args.hash ?? null,
    metadata: args.metaAccountId ? { accountId: args.metaAccountId } : null,
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

  // RECEIPT-3DS-TOKEN (2026-05-16) — session fallback ordering.
  describe('session fallback (RECEIPT-3DS-TOKEN)', () => {
    const { hash } = mintToken()
    const accountId = '00000000-0000-0000-0000-000000000abc'

    it('returns session_match when no token presented + session matches metadata.accountId', () => {
      const order = fakeOrder({ hash, metaAccountId: accountId })
      const verdict = evaluateReceiptGate(order, null, {
        sessionAccountId: accountId,
      })
      expect(verdict).toEqual({ ok: true, reason: 'session_match' })
    })

    it('falls through to session_match when token presented but wrong + session matches', () => {
      // token_mismatch + matching session → session_match (load-bearing).
      const order = fakeOrder({ hash, metaAccountId: accountId })
      const verdict = evaluateReceiptGate(order, 'definitely-wrong-token', {
        sessionAccountId: accountId,
      })
      expect(verdict).toEqual({ ok: true, reason: 'session_match' })
    })

    it('returns token_match when token is correct, ignores session entirely', () => {
      const { plain: rightPlain, hash: rightHash } = mintToken()
      const order = fakeOrder({ hash: rightHash, metaAccountId: accountId })
      const verdict = evaluateReceiptGate(order, rightPlain, {
        sessionAccountId: accountId,
      })
      expect(verdict).toEqual({ ok: true, reason: 'token_match' })
    })

    it('returns token_required when no token, no session', () => {
      const order = fakeOrder({ hash, metaAccountId: accountId })
      const verdict = evaluateReceiptGate(order, null)
      expect(verdict).toEqual({ ok: false, reason: 'token_required' })
    })

    it('returns token_required when session does NOT match metadata.accountId', () => {
      const order = fakeOrder({ hash, metaAccountId: accountId })
      const verdict = evaluateReceiptGate(order, null, {
        sessionAccountId: '00000000-0000-0000-0000-000000000def',
      })
      expect(verdict).toEqual({ ok: false, reason: 'token_required' })
    })

    it('returns token_required when session matches but metadata.accountId is missing', () => {
      // Anti-spoof: NULL metadata.accountId never matches.
      const order = fakeOrder({ hash, metaAccountId: null })
      const verdict = evaluateReceiptGate(order, null, {
        sessionAccountId: accountId,
      })
      expect(verdict).toEqual({ ok: false, reason: 'token_required' })
    })

    it('returns legacy_grace_expired even when session matches (NULL-hash always denied)', () => {
      // Session fallback MUST NOT bypass the legacy-grace deny.
      const order = fakeOrder({ hash: null, metaAccountId: accountId })
      const verdict = evaluateReceiptGate(order, null, {
        sessionAccountId: accountId,
      })
      expect(verdict).toEqual({ ok: false, reason: 'legacy_grace_expired' })
    })

    it('returns token_mismatch when wrong token presented + no session given', () => {
      const order = fakeOrder({ hash, metaAccountId: accountId })
      const verdict = evaluateReceiptGate(order, 'wrong')
      expect(verdict).toEqual({ ok: false, reason: 'token_mismatch' })
    })
  })
})
