import { describe, expect, it } from 'vitest'

import { enforceTrustedBrowserOrigin } from '@/lib/security/request'

// security-audit-2026-06-02 Sub-PR 4 (F10 closure) — origin-absent
// + sec-fetch-absent regression pin.
//
// The contract under test: `enforceTrustedBrowserOrigin` is
// intentionally permissive when BOTH the `Origin` header and the
// `Sec-Fetch-Site` header are absent. This is treated as a legit
// non-browser caller (curl without `-H Origin:`, pre-modern browser).
// Tightening the gate would break legit CLI callers and shift the
// trust model.
//
// For session-bearing routes the cookie + SameSite=Lax keeps
// cross-site CSRF out. For anonymous mutation routes
// (/api/auth/register, /login, /reset-request, /reset-confirm) the
// per-IP + per-email-hash rate-limit is the load-bearing defense.
//
// If a future PR decides to tighten this, it MUST update this test
// intentionally and update SECURITY.md §Accepted security gaps.

function reqWithHeaders(h: Record<string, string>): Request {
  return new Request('https://example.com/api/auth/register', {
    method: 'POST',
    headers: h,
  })
}

describe('enforceTrustedBrowserOrigin — F10 accepted-gap pin', () => {
  it('no Origin + no Sec-Fetch-Site → passes (null return)', () => {
    const result = enforceTrustedBrowserOrigin(reqWithHeaders({}))
    expect(result).toBeNull()
  })

  it('no Origin + Sec-Fetch-Site=same-origin → passes', () => {
    const result = enforceTrustedBrowserOrigin(
      reqWithHeaders({ 'sec-fetch-site': 'same-origin' }),
    )
    expect(result).toBeNull()
  })

  it('no Origin + Sec-Fetch-Site=cross-site → blocked', () => {
    const result = enforceTrustedBrowserOrigin(
      reqWithHeaders({ 'sec-fetch-site': 'cross-site' }),
    )
    expect(result).not.toBeNull()
    expect(result?.status).toBe(403)
  })

  it('Sec-Fetch-Site=none (e.g. address-bar) → passes', () => {
    const result = enforceTrustedBrowserOrigin(
      reqWithHeaders({ 'sec-fetch-site': 'none' }),
    )
    expect(result).toBeNull()
  })
})
