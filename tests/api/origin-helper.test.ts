import { afterEach, describe, expect, it, vi } from 'vitest'

import { resolveCanonicalOrigin } from '@/lib/api/origin'

describe('lib/api/origin.ts :: resolveCanonicalOrigin', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  describe('development mode (NODE_ENV != production)', () => {
    it('returns env origin when NEXT_PUBLIC_SITE_URL is a valid non-loopback URL', () => {
      vi.stubEnv('NODE_ENV', 'development')
      vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://levelchannel.ru')
      const r = resolveCanonicalOrigin(
        new Request('http://localhost:3000/api/whatever'),
      )
      expect(r).toBe('https://levelchannel.ru')
    })

    it('falls back to request.url when env is loopback (any variant)', () => {
      vi.stubEnv('NODE_ENV', 'development')
      for (const loopback of [
        'http://localhost:3000',
        'https://localhost',
        'http://127.0.0.1:3000',
        'http://[::1]:3000',
        'http://0.0.0.0:3000',
        'https://tenant.localhost:3000',
      ]) {
        vi.stubEnv('NEXT_PUBLIC_SITE_URL', loopback)
        const r = resolveCanonicalOrigin(
          new Request('http://localhost:5173/api/whatever'),
        )
        expect(r).toBe('http://localhost:5173')
      }
    })

    it('falls back to request.url when env is malformed', () => {
      vi.stubEnv('NODE_ENV', 'development')
      vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'not a url')
      const r = resolveCanonicalOrigin(
        new Request('http://localhost:3000/api/whatever'),
      )
      expect(r).toBe('http://localhost:3000')
    })

    it('falls back to request.url when env is unset', () => {
      vi.stubEnv('NODE_ENV', 'development')
      vi.stubEnv('NEXT_PUBLIC_SITE_URL', '')
      const r = resolveCanonicalOrigin(
        new Request('http://localhost:3000/api/whatever'),
      )
      expect(r).toBe('http://localhost:3000')
    })

    it('strips path/query, returns origin only', () => {
      vi.stubEnv('NODE_ENV', 'development')
      vi.stubEnv(
        'NEXT_PUBLIC_SITE_URL',
        'https://levelchannel.ru/whatever/path?q=1',
      )
      const r = resolveCanonicalOrigin(
        new Request('http://localhost:3000/api/whatever'),
      )
      expect(r).toBe('https://levelchannel.ru')
    })

    it('rejects ftp/other protocols, falls back to request', () => {
      vi.stubEnv('NODE_ENV', 'development')
      vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'ftp://example.com')
      const r = resolveCanonicalOrigin(
        new Request('http://localhost:3000/api/whatever'),
      )
      expect(r).toBe('http://localhost:3000')
    })
  })

  describe('production mode (NODE_ENV=production fail-closed)', () => {
    it('throws when NEXT_PUBLIC_SITE_URL is unset', () => {
      vi.stubEnv('NODE_ENV', 'production')
      vi.stubEnv('NEXT_PUBLIC_SITE_URL', '')
      expect(() =>
        resolveCanonicalOrigin(new Request('http://localhost:3000/api/x')),
      ).toThrow(/must be set in production/)
    })

    it('throws when NEXT_PUBLIC_SITE_URL is malformed', () => {
      vi.stubEnv('NODE_ENV', 'production')
      vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'not a url')
      expect(() =>
        resolveCanonicalOrigin(new Request('http://localhost:3000/api/x')),
      ).toThrow(/valid URL/)
    })

    it('throws when NEXT_PUBLIC_SITE_URL uses http:', () => {
      vi.stubEnv('NODE_ENV', 'production')
      vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'http://levelchannel.ru')
      expect(() =>
        resolveCanonicalOrigin(new Request('http://localhost:3000/api/x')),
      ).toThrow(/https/)
    })

    it('throws on each loopback variant', () => {
      vi.stubEnv('NODE_ENV', 'production')
      for (const bad of [
        'https://localhost',
        'https://localhost:3000',
        'https://127.0.0.1',
        'https://[::1]',
        'https://0.0.0.0',
        'https://tenant.localhost',
      ]) {
        vi.stubEnv('NEXT_PUBLIC_SITE_URL', bad)
        expect(() =>
          resolveCanonicalOrigin(new Request('http://localhost:3000/api/x')),
        ).toThrow(/loopback/)
      }
    })

    it('returns valid https non-loopback origin', () => {
      vi.stubEnv('NODE_ENV', 'production')
      vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://levelchannel.ru')
      const r = resolveCanonicalOrigin(
        new Request('http://localhost:3000/api/whatever'),
      )
      expect(r).toBe('https://levelchannel.ru')
    })
  })
})
