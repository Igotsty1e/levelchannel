import { describe, expect, it } from 'vitest'

import { resolveSslConfig } from '@/lib/db/pool'

// Tests for the TLS resolver. The resolver is the security gate: in
// production a misconfigured DATABASE_URL or DB_SSL flag must NOT
// silently fall through to a plaintext connection on a REMOTE host.
// Localhost stays open in any env — that's a single-server deploy
// shape (Postgres on the same VPS), which is real prod for this app.

describe('resolveSslConfig', () => {
  describe('localhost auto-detect (any env)', () => {
    const dev = { NODE_ENV: 'development' } as NodeJS.ProcessEnv
    const prod = { NODE_ENV: 'production' } as NodeJS.ProcessEnv

    it.each([
      'postgres://u:p@localhost:5432/db',
      'postgres://u:p@127.0.0.1:5432/db',
      'postgres://u:p@[::1]:5432/db',
      'postgres://u:p@dev-db.local:5432/db',
    ])('disables TLS for %s in dev', (url) => {
      expect(resolveSslConfig(url, dev)).toBe(false)
    })

    it.each([
      'postgres://u:p@localhost:5432/db',
      'postgres://u:p@127.0.0.1:5432/db',
      'postgres://u:p@[::1]:5432/db',
    ])(
      'disables TLS for %s in production (single-server deploys are valid)',
      (url) => {
        expect(resolveSslConfig(url, prod)).toBe(false)
      },
    )
  })

  describe('non-local host', () => {
    it('forces strict TLS for managed Postgres in dev', () => {
      const url = 'postgres://u:p@db.example.com:5432/levelchannel'
      expect(
        resolveSslConfig(url, { NODE_ENV: 'development' } as NodeJS.ProcessEnv),
      ).toEqual({ rejectUnauthorized: true })
    })

    it('forces strict TLS for managed Postgres in production', () => {
      const url = 'postgres://u:p@prod-db.example.com:5432/levelchannel'
      expect(
        resolveSslConfig(url, { NODE_ENV: 'production' } as NodeJS.ProcessEnv),
      ).toEqual({ rejectUnauthorized: true })
    })

    it('forces strict TLS even when URL hints sslmode=disable', () => {
      const url = 'postgres://u:p@db.example.com:5432/lc?sslmode=disable'
      expect(
        resolveSslConfig(url, { NODE_ENV: 'production' } as NodeJS.ProcessEnv),
      ).toEqual({ rejectUnauthorized: true })
    })
  })

  describe('production safety gates fire only for remote hosts', () => {
    const prod = { NODE_ENV: 'production' } as NodeJS.ProcessEnv

    it('refuses DB_SSL=disable on a remote host', () => {
      const url = 'postgres://u:p@prod-db.example.com:5432/levelchannel'
      expect(() =>
        resolveSslConfig(url, { ...prod, DB_SSL: 'disable' }),
      ).toThrow(/non-local hosts in production/i)
    })

    it.each(['off', 'false', '0', 'no'])(
      'refuses DB_SSL=%s as a disable alias on a remote host',
      (val) => {
        const url = 'postgres://u:p@prod-db.example.com:5432/levelchannel'
        expect(() =>
          resolveSslConfig(url, { ...prod, DB_SSL: val }),
        ).toThrow(/non-local hosts in production/i)
      },
    )

    it('allows DB_SSL=disable on localhost in production (loopback is meaningless to TLS)', () => {
      const url = 'postgres://u:p@127.0.0.1:5432/levelchannel'
      expect(
        resolveSslConfig(url, { ...prod, DB_SSL: 'disable' }),
      ).toBe(false)
    })

    it('refuses DB_SSL_REJECT_UNAUTHORIZED=false on a remote host', () => {
      const url = 'postgres://u:p@prod-db.example.com:5432/levelchannel'
      expect(() =>
        resolveSslConfig(url, {
          ...prod,
          DB_SSL_REJECT_UNAUTHORIZED: 'false',
        }),
      ).toThrow(/non-local hosts in production/i)
    })

    it('allows DB_SSL_REJECT_UNAUTHORIZED=false on localhost in production', () => {
      const url = 'postgres://u:p@127.0.0.1:5432/levelchannel'
      expect(
        resolveSslConfig(url, {
          ...prod,
          DB_SSL_REJECT_UNAUTHORIZED: 'false',
        }),
      ).toBe(false)
    })
  })

  describe('explicit overrides', () => {
    const dev = { NODE_ENV: 'development' } as NodeJS.ProcessEnv

    it('DB_SSL=require forces strict TLS even on localhost', () => {
      const url = 'postgres://u:p@localhost:5432/db'
      expect(resolveSslConfig(url, { ...dev, DB_SSL: 'require' })).toEqual({
        rejectUnauthorized: true,
      })
    })

    it('DB_SSL=disable allowed on remote host in dev', () => {
      const url = 'postgres://u:p@db.example.com:5432/lc'
      expect(resolveSslConfig(url, { ...dev, DB_SSL: 'disable' })).toBe(false)
    })

    it('DB_SSL_REJECT_UNAUTHORIZED=false allowed on remote host in dev (encrypted but lax)', () => {
      const url = 'postgres://u:p@db.example.com:5432/lc'
      expect(
        resolveSslConfig(url, {
          ...dev,
          DB_SSL_REJECT_UNAUTHORIZED: 'false',
        }),
      ).toEqual({ rejectUnauthorized: false })
    })
  })

  describe('malformed URL', () => {
    it('falls back to strict TLS rather than plaintext', () => {
      expect(
        resolveSslConfig('not-a-url', {
          NODE_ENV: 'development',
        } as NodeJS.ProcessEnv),
      ).toEqual({ rejectUnauthorized: true })
    })
  })
})
