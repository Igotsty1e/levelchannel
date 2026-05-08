import { describe, expect, it } from 'vitest'

import { assembleCsp, generateNonce } from '@/lib/security/csp'

describe('assembleCsp', () => {
  it('embeds the nonce in script-src AND style-src', () => {
    const csp = assembleCsp({ nonce: 'abc123' })
    expect(csp).toMatch(/script-src [^;]*'nonce-abc123'/)
    expect(csp).toMatch(/style-src [^;]*'nonce-abc123'/)
  })

  it('keeps unsafe-inline in script-src and style-src for PR 1', () => {
    // PR 1 ships the machinery without removing 'unsafe-inline'. The
    // nonce is listed alongside it so behavior is identical to today.
    // Browsers honour 'unsafe-inline' over the nonce when both are
    // present. PR 3 removes 'unsafe-inline' from script-src; PR 4
    // splits style-src.
    const csp = assembleCsp({ nonce: 'x' })
    expect(csp).toMatch(/script-src [^;]*'unsafe-inline'/)
    expect(csp).toMatch(/style-src [^;]*'unsafe-inline'/)
  })

  it('preserves the existing CloudPayments + Sentry + GA allowlists', () => {
    const csp = assembleCsp({ nonce: 'x' })
    expect(csp).toContain('https://widget.cloudpayments.ru')
    expect(csp).toContain('https://api.cloudpayments.ru')
    expect(csp).toContain('https://*.cloudpayments.ru')
    expect(csp).toContain('https://*.ingest.de.sentry.io')
    expect(csp).toContain('https://*.ingest.sentry.io')
    expect(csp).toContain('https://www.googletagmanager.com')
    expect(csp).toContain('https://www.google-analytics.com')
  })

  it('keeps default-src self, frame-ancestors none, object-src none', () => {
    const csp = assembleCsp({ nonce: 'x' })
    expect(csp).toContain(`default-src 'self'`)
    expect(csp).toContain(`frame-ancestors 'none'`)
    expect(csp).toContain(`object-src 'none'`)
  })

  it('renders directives separated by semicolons', () => {
    const csp = assembleCsp({ nonce: 'x' })
    const directives = csp.split(';').map((d) => d.trim())
    expect(directives.length).toBeGreaterThan(8)
    // Sanity: every directive starts with a token char (no leading
    // whitespace inside the assembled value).
    for (const d of directives) {
      expect(d).toMatch(/^[a-z][a-z0-9-]*\s/)
    }
  })

  it('escapes the nonce literally without quoting injection', () => {
    // If a malicious caller supplied a nonce containing `'` or other
    // CSP-meaningful chars, the policy would break. assembleCsp does
    // NOT sanitise — generateNonce is the only sanctioned producer.
    // This test pins that contract: the nonce is interpolated as-is.
    const csp = assembleCsp({ nonce: "wat'evil" })
    expect(csp).toContain(`'nonce-wat'evil'`)
  })
})

describe('generateNonce', () => {
  it('returns a non-empty base64-shaped string', () => {
    const nonce = generateNonce()
    expect(nonce.length).toBeGreaterThan(0)
    // base64 of crypto.randomUUID() — 22 chars body + 2 padding `==`
    // (UUID is 36 chars; base64 of 36 bytes = 48 chars).
    expect(nonce).toMatch(/^[A-Za-z0-9+/]+=*$/)
  })

  it('returns a unique value per call (statistical, not strict)', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 20; i++) seen.add(generateNonce())
    expect(seen.size).toBe(20)
  })
})
