import { describe, expect, it } from 'vitest'

import { resolveSslConfig } from '@/lib/db/pool'

// Tests for the TLS resolver. The resolver is the security gate: in
// production, a misconfigured DATABASE_URL or DB_SSL flag must NOT
// silently fall through to a plaintext connection. These cases pin
// the policy.

describe('resolveSslConfig', () => {
  describe('localhost auto-detect (non-prod)', () => {
    const env = { NODE_ENV: 'development' } as NodeJS.ProcessEnv

    it.each([
      'postgres://u:p@localhost:5432/db',
      'postgres://u:p@127.0.0.1:5432/db',
      'postgres://u:p@[::1]:5432/db',
      'postgres://u:p@dev-db.local:5432/db',
    ])('disables TLS for %s', (url) => {
      expect(resolveSslConfig(url, env)).toBe(false)
    })
  })

  describe('non-local host (non-prod)', () => {
    const env = { NODE_ENV: 'development' } as NodeJS.ProcessEnv

    it('forces strict TLS for managed Postgres', () => {
      const url = 'postgres://u:p@db.example.com:5432/levelchannel'
      expect(resolveSslConfig(url, env)).toEqual({ rejectUnauthorized: true })
    })

    it('forces strict TLS even when URL hints sslmode=disable', () => {
      // The JS-side ssl option overrides URL hints — that's the point.
      const url = 'postgres://u:p@db.example.com:5432/lc?sslmode=disable'
      expect(resolveSslConfig(url, env)).toEqual({ rejectUnauthorized: true })
    })
  })

  describe('production', () => {
    const prod = { NODE_ENV: 'production' } as NodeJS.ProcessEnv

    it('forces strict TLS on managed hosts', () => {
      const url = 'postgres://u:p@prod-db.example.com:5432/levelchannel'
      expect(resolveSslConfig(url, prod)).toEqual({ rejectUnauthorized: true })
    })

    it('refuses DB_SSL=disable', () => {
      const url = 'postgres://u:p@prod-db.example.com:5432/levelchannel'
      expect(() =>
        resolveSslConfig(url, { ...prod, DB_SSL: 'disable' }),
      ).toThrow(/rejected in production/i)
    })

    it.each(['off', 'false', '0', 'no'])(
      'refuses DB_SSL=%s as a disable alias',
      (val) => {
        const url = 'postgres://u:p@prod-db.example.com:5432/levelchannel'
        expect(() =>
          resolveSslConfig(url, { ...prod, DB_SSL: val }),
        ).toThrow(/rejected in production/i)
      },
    )

    it('refuses localhost DATABASE_URL', () => {
      const url = 'postgres://u:p@localhost:5432/levelchannel'
      expect(() => resolveSslConfig(url, prod)).toThrow(
        /localhost in production/i,
      )
    })

    it('refuses DB_SSL_REJECT_UNAUTHORIZED=false', () => {
      const url = 'postgres://u:p@prod-db.example.com:5432/levelchannel'
      expect(() =>
        resolveSslConfig(url, {
          ...prod,
          DB_SSL_REJECT_UNAUTHORIZED: 'false',
        }),
      ).toThrow(/rejected in production/i)
    })
  })

  describe('explicit overrides (non-prod)', () => {
    const env = { NODE_ENV: 'development' } as NodeJS.ProcessEnv

    it('DB_SSL=require forces strict TLS even on localhost', () => {
      const url = 'postgres://u:p@localhost:5432/db'
      expect(resolveSslConfig(url, { ...env, DB_SSL: 'require' })).toEqual({
        rejectUnauthorized: true,
      })
    })

    it('DB_SSL=disable allowed in dev', () => {
      const url = 'postgres://u:p@db.example.com:5432/lc'
      expect(resolveSslConfig(url, { ...env, DB_SSL: 'disable' })).toBe(false)
    })

    it('DB_SSL_REJECT_UNAUTHORIZED=false allowed in dev (encrypted but lax)', () => {
      const url = 'postgres://u:p@db.example.com:5432/lc'
      expect(
        resolveSslConfig(url, {
          ...env,
          DB_SSL_REJECT_UNAUTHORIZED: 'false',
        }),
      ).toEqual({ rejectUnauthorized: false })
    })
  })

  describe('malformed URL', () => {
    it('falls back to strict TLS rather than plaintext', () => {
      const env = { NODE_ENV: 'development' } as NodeJS.ProcessEnv
      expect(resolveSslConfig('not-a-url', env)).toEqual({
        rejectUnauthorized: true,
      })
    })
  })
})
