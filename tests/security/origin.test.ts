import { describe, expect, it } from 'vitest'

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
})

describe('getClientIp', () => {
  it('uses first hop in x-forwarded-for', () => {
    const ip = getClientIp(
      buildRequest({ 'x-forwarded-for': '203.0.113.5, 10.0.0.1' }),
    )
    expect(ip).toBe('203.0.113.5')
  })

  it('falls back to x-real-ip', () => {
    expect(getClientIp(buildRequest({ 'x-real-ip': '203.0.113.9' }))).toBe(
      '203.0.113.9',
    )
  })

  it('falls back to cf-connecting-ip', () => {
    expect(
      getClientIp(buildRequest({ 'cf-connecting-ip': '198.51.100.1' })),
    ).toBe('198.51.100.1')
  })

  it('returns "unknown" when nothing is set', () => {
    expect(getClientIp(buildRequest({}))).toBe('unknown')
  })
})
