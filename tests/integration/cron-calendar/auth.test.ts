import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { POST as pullRoute } from '@/app/api/cron/calendar/pull/route'
import { POST as pushRoute } from '@/app/api/cron/calendar/push/route'
import { POST as intentsRoute } from '@/app/api/cron/calendar/intents/route'
import { POST as renewChannelsRoute } from '@/app/api/cron/calendar/renew-channels/route'
import { POST as reviveBlockedRoute } from '@/app/api/cron/calendar/revive-blocked/route'
import { POST as reconcileRoute } from '@/app/api/cron/calendar/reconcile/route'

import { buildCronRequest } from '../helpers'
import '../setup'

const TEST_SECRET = 's'.repeat(48)

beforeEach(() => {
  process.env.CRON_SHARED_SECRET = TEST_SECRET
  // Stub fetch to a no-op so any wrapped Google calls inside the
  // workers don't actually hit the network if a 200 path is reached.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ items: [] }),
      text: async () => '{}',
    }) as unknown as Response),
  )
})

afterEach(() => {
  delete process.env.CRON_SHARED_SECRET
  delete process.env.CRON_TRUSTED_HOST
  vi.unstubAllGlobals()
})

const ROUTES = [
  { name: 'pull', handler: pullRoute, path: '/api/cron/calendar/pull' },
  { name: 'push', handler: pushRoute, path: '/api/cron/calendar/push' },
  { name: 'intents', handler: intentsRoute, path: '/api/cron/calendar/intents' },
  {
    name: 'renew-channels',
    handler: renewChannelsRoute,
    path: '/api/cron/calendar/renew-channels',
  },
  {
    name: 'revive-blocked',
    handler: reviveBlockedRoute,
    path: '/api/cron/calendar/revive-blocked',
  },
  { name: 'reconcile', handler: reconcileRoute, path: '/api/cron/calendar/reconcile' },
]

describe('cron-calendar route auth — two-layer gate (host + bearer)', () => {
  for (const r of ROUTES) {
    describe(`/api/cron/calendar/${r.name}`, () => {
      it('404 on external Host header (simulates nginx-forwarded request)', async () => {
        const req = buildCronRequest(r.path, {
          host: 'levelchannel.ru',
          bearer: TEST_SECRET,
        })
        const res = await r.handler(req)
        expect(res.status).toBe(404)
      })

      it('401 on missing bearer, even with loopback Host', async () => {
        const req = buildCronRequest(r.path, { host: '127.0.0.1:3000' })
        const res = await r.handler(req)
        expect(res.status).toBe(401)
      })

      it('401 on wrong bearer, even with loopback Host', async () => {
        const req = buildCronRequest(r.path, {
          host: '127.0.0.1:3000',
          bearer: 'wrong-secret',
        })
        const res = await r.handler(req)
        expect(res.status).toBe(401)
      })

      it('200 happy path: loopback Host + correct bearer (worker runs no-op)', async () => {
        const req = buildCronRequest(r.path, {
          host: '127.0.0.1:3000',
          bearer: TEST_SECRET,
        })
        const res = await r.handler(req)
        expect(res.status).toBe(200)
        const j = await res.json()
        expect(j.ok).toBe(true)
      })

      it('200 happy path with localhost Host', async () => {
        const req = buildCronRequest(r.path, {
          host: 'localhost:3000',
          bearer: TEST_SECRET,
        })
        const res = await r.handler(req)
        expect(res.status).toBe(200)
      })

      it('200 via CRON_TRUSTED_HOST allowlist', async () => {
        process.env.CRON_TRUSTED_HOST = 'cron-runner.internal'
        const req = buildCronRequest(r.path, {
          host: 'cron-runner.internal',
          bearer: TEST_SECRET,
        })
        const res = await r.handler(req)
        expect(res.status).toBe(200)
      })

      it('503 when CRON_SHARED_SECRET env is unset (server misconfig)', async () => {
        delete process.env.CRON_SHARED_SECRET
        const req = buildCronRequest(r.path, {
          host: '127.0.0.1:3000',
          bearer: 'anything',
        })
        const res = await r.handler(req)
        expect(res.status).toBe(503)
      })
    })
  }
})
