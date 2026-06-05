import { afterEach, describe, expect, it, vi } from 'vitest'

import { resolveCanonicalOrigin } from '@/lib/api/origin'

describe('lib/api/origin.ts :: resolveCanonicalOrigin', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns env origin when NEXT_PUBLIC_SITE_URL is a valid https URL', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://levelchannel.ru')
    const r = resolveCanonicalOrigin(
      new Request('http://localhost:3000/api/whatever'),
    )
    expect(r).toBe('https://levelchannel.ru')
  })

  it('falls back to request.url when env points at localhost', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'http://localhost:3000')
    const r = resolveCanonicalOrigin(
      new Request('http://localhost:5173/api/whatever'),
    )
    expect(r).toBe('http://localhost:5173')
  })

  it('falls back to request.url when env is malformed', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'not a url')
    const r = resolveCanonicalOrigin(
      new Request('http://localhost:3000/api/whatever'),
    )
    expect(r).toBe('http://localhost:3000')
  })

  it('falls back to request.url when env is unset', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '')
    const r = resolveCanonicalOrigin(
      new Request('http://localhost:3000/api/whatever'),
    )
    expect(r).toBe('http://localhost:3000')
  })

  it('strips path/query, returns origin only', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://levelchannel.ru/whatever/path?q=1')
    const r = resolveCanonicalOrigin(
      new Request('http://localhost:3000/api/whatever'),
    )
    expect(r).toBe('https://levelchannel.ru')
  })

  it('rejects ftp/other protocols, falls back to request', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'ftp://example.com')
    const r = resolveCanonicalOrigin(
      new Request('http://localhost:3000/api/whatever'),
    )
    expect(r).toBe('http://localhost:3000')
  })
})
