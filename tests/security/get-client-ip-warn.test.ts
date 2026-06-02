import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  __resetGetClientIpWarnThrottleForTests,
  getClientIp,
} from '@/lib/security/request'

// F5 (security-audit-2026-06-02 Sub-PR 3) — in production, `getClientIp`
// emits a structured `console.warn` when `X-Real-IP` is absent so an
// nginx config drift is visible to the operator via journald. Return
// value is unchanged — pure observability.

function buildRequest(headers: Record<string, string>) {
  return new Request('http://localhost:3000/api/test', {
    method: 'POST',
    headers,
  })
}

describe('getClientIp — production warn on missing X-Real-IP (F5)', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    __resetGetClientIpWarnThrottleForTests()
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubEnv('NODE_ENV', 'production')
  })

  afterEach(() => {
    warnSpy.mockRestore()
    vi.unstubAllEnvs()
    __resetGetClientIpWarnThrottleForTests()
  })

  it('warns when X-Real-IP absent and NODE_ENV=production', () => {
    const ip = getClientIp(buildRequest({}))
    expect(ip).toBe('unknown')
    expect(warnSpy).toHaveBeenCalledTimes(1)

    const arg = warnSpy.mock.calls[0]?.[0]
    expect(typeof arg).toBe('string')
    const parsed = JSON.parse(String(arg))
    expect(parsed.tag).toBe('[security/getClientIp]')
    expect(parsed.event).toBe('x_real_ip_missing')
    expect(parsed.hasCfConnectingIp).toBe(false)
    expect(typeof parsed.message).toBe('string')
  })

  it('does NOT warn when X-Real-IP is present', () => {
    const ip = getClientIp(buildRequest({ 'x-real-ip': '203.0.113.9' }))
    expect(ip).toBe('203.0.113.9')
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('warns even when only cf-connecting-ip is present (signals the gap)', () => {
    // cf-connecting-ip alone still indicates X-Real-IP is missing; the
    // alert remains useful to flag nginx drift even if a future
    // Cloudflare edge mitigates the bucket collapse.
    const ip = getClientIp(buildRequest({ 'cf-connecting-ip': '198.51.100.1' }))
    expect(ip).toBe('198.51.100.1')
    expect(warnSpy).toHaveBeenCalledTimes(1)
    const parsed = JSON.parse(String(warnSpy.mock.calls[0]?.[0]))
    expect(parsed.hasCfConnectingIp).toBe(true)
  })

  it('throttles to one warn per 60s window', () => {
    getClientIp(buildRequest({}))
    getClientIp(buildRequest({}))
    getClientIp(buildRequest({}))
    expect(warnSpy).toHaveBeenCalledTimes(1)
  })
})

describe('getClientIp — does NOT warn outside production', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    __resetGetClientIpWarnThrottleForTests()
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubEnv('NODE_ENV', 'development')
  })

  afterEach(() => {
    warnSpy.mockRestore()
    vi.unstubAllEnvs()
    __resetGetClientIpWarnThrottleForTests()
  })

  it('stays silent in development (local dev has no nginx)', () => {
    const ip = getClientIp(buildRequest({}))
    expect(ip).toBe('unknown')
    expect(warnSpy).not.toHaveBeenCalled()
  })
})
