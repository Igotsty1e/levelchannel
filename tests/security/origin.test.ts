import { afterEach, describe, expect, it } from 'vitest'

import {
  enforceTrustedBrowserOrigin,
  getClientIp,
} from '@/lib/security/request'

function buildRequest(headers: Record<string, string>) {
  return new Request('http://localhost:3000/api/payments', {
    method: 'POST',
    headers,
  })
}

describe('enforceTrustedBrowserOrigin', () => {
  it('passes through when no origin header is set (server-to-server)', () => {
    expect(enforceTrustedBrowserOrigin(buildRequest({}))).toBeNull()
  })

  it('passes when origin matches configured siteUrl', () => {
    expect(
      enforceTrustedBrowserOrigin(
        buildRequest({ origin: 'http://localhost:3000' }),
      ),
    ).toBeNull()
  })

  it('rejects cross-site Sec-Fetch-Site', () => {
    const response = enforceTrustedBrowserOrigin(
      buildRequest({
        origin: 'http://localhost:3000',
        'sec-fetch-site': 'cross-site',
      }),
    )
    expect(response?.status).toBe(403)
  })

  it('allows same-origin Sec-Fetch-Site', () => {
    expect(
      enforceTrustedBrowserOrigin(
        buildRequest({
          origin: 'http://localhost:3000',
          'sec-fetch-site': 'same-origin',
        }),
      ),
    ).toBeNull()
  })

  it('rejects untrusted origin', () => {
    const response = enforceTrustedBrowserOrigin(
      buildRequest({ origin: 'https://attacker.example' }),
    )
    expect(response?.status).toBe(403)
  })

  // DEV_EXTRA_ALLOWED_ORIGINS — restores the dev/test escape hatch that
  // was reverted from PR #551. Test pins both halves of the contract:
  //   - opt-in entries pass when set
  //   - they are ignored in production NODE_ENV (no widening on prod)
  describe('DEV_EXTRA_ALLOWED_ORIGINS', () => {
    const ORIGINAL = process.env.DEV_EXTRA_ALLOWED_ORIGINS
    const ORIGINAL_NODE_ENV = process.env.NODE_ENV
    afterEach(() => {
      process.env.DEV_EXTRA_ALLOWED_ORIGINS = ORIGINAL
      process.env.NODE_ENV = ORIGINAL_NODE_ENV
    })

    it('passes when origin is listed in DEV_EXTRA_ALLOWED_ORIGINS (dev)', () => {
      process.env.NODE_ENV = 'development'
      process.env.DEV_EXTRA_ALLOWED_ORIGINS =
        'http://192.168.6.31:3010,https://abc.trycloudflare.com'
      expect(
        enforceTrustedBrowserOrigin(
          buildRequest({ origin: 'https://abc.trycloudflare.com' }),
        ),
      ).toBeNull()
    })

    it('ignores DEV_EXTRA_ALLOWED_ORIGINS in production', () => {
      process.env.NODE_ENV = 'production'
      process.env.DEV_EXTRA_ALLOWED_ORIGINS = 'https://abc.trycloudflare.com'
      const response = enforceTrustedBrowserOrigin(
        buildRequest({ origin: 'https://abc.trycloudflare.com' }),
      )
      expect(response?.status).toBe(403)
    })

    it('tolerates whitespace and empty entries', () => {
      process.env.NODE_ENV = 'development'
      process.env.DEV_EXTRA_ALLOWED_ORIGINS = ' , https://abc.trycloudflare.com , '
      expect(
        enforceTrustedBrowserOrigin(
          buildRequest({ origin: 'https://abc.trycloudflare.com' }),
        ),
      ).toBeNull()
    })
  })
})

describe('getClientIp (Codex #4b — XFF spoof closed)', () => {
  it('IGNORES x-forwarded-for entirely (was the bypass shape)', () => {
    // Pre-fix: this returned '203.0.113.5' (the attacker-supplied first
    // hop). Now we never trust XFF — nginx appends to it instead of
    // overwriting, so the first hop is always client-controlled. The
    // bucket key for rate-limit MUST NOT change based on this header.
    const ip = getClientIp(
      buildRequest({ 'x-forwarded-for': '203.0.113.5, 10.0.0.1' }),
    )
    expect(ip).toBe('unknown')
  })

  it('uses x-real-ip (production nginx sets it from $remote_addr)', () => {
    expect(getClientIp(buildRequest({ 'x-real-ip': '203.0.113.9' }))).toBe(
      '203.0.113.9',
    )
  })

  it('x-real-ip wins even when x-forwarded-for is also present', () => {
    // An attacker who learns the X-Real-IP convention may try sending
    // both headers. nginx OVERWRITES X-Real-IP from the socket, so by
    // the time this code runs, X-Real-IP is the trusted anchor. XFF is
    // ignored regardless.
    expect(
      getClientIp(
        buildRequest({
          'x-real-ip': '203.0.113.9',
          'x-forwarded-for': '1.2.3.4',
        }),
      ),
    ).toBe('203.0.113.9')
  })

  it('falls back to cf-connecting-ip when x-real-ip is absent', () => {
    expect(
      getClientIp(buildRequest({ 'cf-connecting-ip': '198.51.100.1' })),
    ).toBe('198.51.100.1')
  })

  it('returns "unknown" when nothing is set (local dev / no proxy)', () => {
    expect(getClientIp(buildRequest({}))).toBe('unknown')
  })
})
