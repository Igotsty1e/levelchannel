import { describe, expect, it } from 'vitest'

import { assembleCsp, generateNonce } from '@/lib/security/csp'

describe('assembleCsp', () => {
  it('embeds the nonce in script-src (PR 1 contract)', () => {
    const csp = assembleCsp({ nonce: 'abc123' })
    expect(csp).toMatch(/script-src [^;]*'nonce-abc123'/)
  })

  it('keeps unsafe-inline in script-src (PR 3 still upstream-blocked)', () => {
    // PR 1 left 'unsafe-inline' in script-src as a no-op alongside the
    // nonce; PR 3 was supposed to drop it but is blocked on a Next.js
    // 16 auto-stamp gap (RSC payload <script> blocks don't carry the
    // nonce). Until upstream fixes that, 'unsafe-inline' stays.
    const csp = assembleCsp({ nonce: 'x' })
    expect(csp).toMatch(/script-src [^;]*'unsafe-inline'/)
  })

  it('does NOT carry unsafe-inline on style-src (PR 4 contract)', () => {
    // PR 4 split style-src: the directive controlling <style> tags +
    // <link rel="stylesheet"> is now strict (`'self'` only). The
    // separate style-src-attr keeps `'unsafe-inline'` for the 198
    // inline JSX `style={...}` attributes which compile to DOM
    // `style="..."` HTML attributes.
    const csp = assembleCsp({ nonce: 'x' })
    const styleSrc = csp.match(/(?:^|; )style-src [^;]*/)?.[0] ?? ''
    expect(styleSrc).not.toMatch(/'unsafe-inline'/)
    expect(csp).toMatch(/style-src-attr 'unsafe-inline'/)
  })

  it('drops dead Google Fonts allowlist entries (PR 4)', () => {
    // next/font/google self-hosts since Next 13+. Verified 2026-05-08
    // on prod: 0 references to fonts.googleapis.com or fonts.gstatic.com
    // in rendered HTML. CSP entries removed.
    const csp = assembleCsp({ nonce: 'x' })
    expect(csp).not.toContain('fonts.googleapis.com')
    expect(csp).not.toContain('fonts.gstatic.com')
  })

  it('preserves the existing CloudPayments + Sentry + GA allowlists', () => {
    const csp = assembleCsp({ nonce: 'x' })
    expect(csp).toContain('https://widget.cloudpayments.ru')
    expect(csp).toContain('https://api.cloudpayments.ru')
    expect(csp).toContain('https://*.cloudpayments.ru')
    expect(csp).toContain('https://*.ingest.de.sentry.io')
    expect(csp).toContain('https://*.ingest.sentry.io')
    // GA / GTM kept until Open Question #1 (defer GA wiring intent) is
    // resolved. See `docs/plans/csp-hardening.md`.
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
