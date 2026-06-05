import { describe, expect, it } from 'vitest'

import {
  isLiteralLoopbackHostname,
  isLoopbackOriginHostname,
  isLoopbackOriginUrl,
} from '@/lib/security/local-host'

describe('isLiteralLoopbackHostname (STRICT)', () => {
  it('accepts literal loopback addresses', () => {
    expect(isLiteralLoopbackHostname('localhost')).toBe(true)
    expect(isLiteralLoopbackHostname('LOCALHOST')).toBe(true)
    expect(isLiteralLoopbackHostname('127.0.0.1')).toBe(true)
    expect(isLiteralLoopbackHostname('::1')).toBe(true)
    expect(isLiteralLoopbackHostname('[::1]')).toBe(true)
  })

  it('rejects 0.0.0.0 (not loopback in strict trust context)', () => {
    expect(isLiteralLoopbackHostname('0.0.0.0')).toBe(false)
  })

  it('rejects *.localhost subdomains', () => {
    expect(isLiteralLoopbackHostname('foo.localhost')).toBe(false)
    expect(isLiteralLoopbackHostname('tenant.localhost')).toBe(false)
  })

  it('rejects real hostnames', () => {
    expect(isLiteralLoopbackHostname('levelchannel.ru')).toBe(false)
    expect(isLiteralLoopbackHostname('db.attacker.local')).toBe(false)
    expect(isLiteralLoopbackHostname('localhost.attacker.com')).toBe(false)
  })

  it('rejects empty/null/undefined', () => {
    expect(isLiteralLoopbackHostname('')).toBe(false)
    expect(isLiteralLoopbackHostname(null)).toBe(false)
    expect(isLiteralLoopbackHostname(undefined)).toBe(false)
  })
})

describe('isLoopbackOriginHostname (WIDE)', () => {
  it('accepts everything STRICT accepts', () => {
    expect(isLoopbackOriginHostname('localhost')).toBe(true)
    expect(isLoopbackOriginHostname('127.0.0.1')).toBe(true)
    expect(isLoopbackOriginHostname('::1')).toBe(true)
    expect(isLoopbackOriginHostname('[::1]')).toBe(true)
  })

  it('also accepts 0.0.0.0', () => {
    expect(isLoopbackOriginHostname('0.0.0.0')).toBe(true)
  })

  it('also accepts *.localhost (RFC 6761)', () => {
    expect(isLoopbackOriginHostname('foo.localhost')).toBe(true)
    expect(isLoopbackOriginHostname('tenant.localhost')).toBe(true)
  })

  it('rejects real hostnames', () => {
    expect(isLoopbackOriginHostname('levelchannel.ru')).toBe(false)
    expect(isLoopbackOriginHostname('db.attacker.local')).toBe(false)
    expect(isLoopbackOriginHostname('localhost.attacker.com')).toBe(false)
  })

  it('rejects empty/null/undefined', () => {
    expect(isLoopbackOriginHostname('')).toBe(false)
    expect(isLoopbackOriginHostname(null)).toBe(false)
    expect(isLoopbackOriginHostname(undefined)).toBe(false)
  })
})

describe('isLoopbackOriginUrl', () => {
  it('accepts loopback URLs', () => {
    expect(isLoopbackOriginUrl('http://localhost:3000')).toBe(true)
    expect(isLoopbackOriginUrl('https://localhost')).toBe(true)
    expect(isLoopbackOriginUrl('http://127.0.0.1:3000')).toBe(true)
    expect(isLoopbackOriginUrl('http://[::1]:3000')).toBe(true)
    expect(isLoopbackOriginUrl('http://0.0.0.0:3000')).toBe(true)
    expect(isLoopbackOriginUrl('https://tenant.localhost:3000')).toBe(true)
  })

  it('rejects real URLs', () => {
    expect(isLoopbackOriginUrl('https://levelchannel.ru')).toBe(false)
    expect(isLoopbackOriginUrl('https://db.attacker.local')).toBe(false)
    expect(isLoopbackOriginUrl('https://localhost.attacker.com')).toBe(false)
  })

  it('rejects malformed URL string', () => {
    expect(isLoopbackOriginUrl('not a url')).toBe(false)
    expect(isLoopbackOriginUrl('')).toBe(false)
  })

  it('accepts URL instances', () => {
    expect(isLoopbackOriginUrl(new URL('http://localhost'))).toBe(true)
    expect(isLoopbackOriginUrl(new URL('https://levelchannel.ru'))).toBe(false)
  })
})
