import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Codex 2026-05-07 P0 regression — verifies anonymous callers can no
// longer probe / DELETE / charge against an arbitrary email's saved
// card. Mocks the session resolver and asserts:
//
//   1. Anonymous request → 401 from BOTH /saved-card POST + DELETE
//      and /charge-token. The store is never consulted; the provider
//      is never called.
//
//   2. With a session, the server uses session.account.email and
//      IGNORES body.customerEmail (anti-confused-deputy).

const getCurrentSessionMock = vi.fn()

vi.mock('@/lib/auth/sessions', () => ({
  getCurrentSession: () => getCurrentSessionMock(),
}))

const enforceRateLimitMock = vi.fn().mockResolvedValue(null)
const enforceTrustedBrowserOriginMock = vi.fn().mockReturnValue(null)
const getClientIpMock = vi.fn().mockReturnValue('203.0.113.1')

vi.mock('@/lib/security/request', () => ({
  enforceRateLimit: (...a: unknown[]) => enforceRateLimitMock(...a),
  enforceTrustedBrowserOrigin: () => enforceTrustedBrowserOriginMock(),
  getClientIp: () => getClientIpMock(),
}))

const getCardTokenByEmailMock = vi.fn()
const deleteCardTokenMock = vi.fn()

vi.mock('@/lib/payments/store', () => ({
  getCardTokenByEmail: (email: string) => getCardTokenByEmailMock(email),
  deleteCardToken: (email: string) => deleteCardTokenMock(email),
}))

vi.mock('@/lib/payments/tokens', () => ({
  toPublicSavedCard: (raw: unknown) => raw,
}))

const chargeWithSavedCardMock = vi.fn()

vi.mock('@/lib/payments/provider', () => ({
  chargeWithSavedCard: (args: unknown) => chargeWithSavedCardMock(args),
}))

vi.mock('@/lib/payments/config', () => ({
  paymentConfig: {
    provider: 'cloudpayments',
    siteUrl: 'https://levelchannel.ru',
    storageBackend: 'postgres',
  },
}))

vi.mock('@/lib/security/idempotency', () => ({
  withIdempotency: async (
    _r: Request,
    _scope: string,
    _body: string,
    work: () => Promise<{ status: number; body: unknown }>,
  ) => {
    const out = await work()
    return new Response(JSON.stringify(out.body), {
      status: out.status,
      headers: { 'content-type': 'application/json' },
    })
  },
}))

vi.mock('@/lib/audit/payment-events', async () => {
  const real = await vi.importActual<
    typeof import('@/lib/audit/payment-events')
  >('@/lib/audit/payment-events')
  return {
    ...real,
    recordPaymentAuditEvent: vi.fn().mockResolvedValue(true),
  }
})

vi.mock('@/lib/telemetry/store', () => ({
  appendCheckoutTelemetryEvent: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/legal/personal-data', () => ({
  buildPersonalDataConsentSnapshot: () => ({
    revisionId: 'r1',
    acceptedAt: '2026-05-07T00:00:00Z',
  }),
}))

import { POST as savedCardPost, DELETE as savedCardDelete } from '@/app/api/payments/saved-card/route'
import { POST as chargeTokenPost } from '@/app/api/payments/charge-token/route'

function jsonRequest(method: string, body: unknown) {
  return new Request('https://levelchannel.ru/api/payments/x', {
    method,
    headers: {
      'content-type': 'application/json',
      origin: 'https://levelchannel.ru',
    },
    body: JSON.stringify(body),
  })
}

describe('saved-card / charge-token auth gate (Codex P0 2026-05-07)', () => {
  beforeEach(() => {
    getCurrentSessionMock.mockReset()
    getCardTokenByEmailMock.mockReset()
    deleteCardTokenMock.mockReset()
    chargeWithSavedCardMock.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('anonymous caller', () => {
    beforeEach(() => {
      getCurrentSessionMock.mockResolvedValue(null)
    })

    it('GET-by-email saved-card → 401, store never consulted', async () => {
      const res = await savedCardPost(
        jsonRequest('POST', { customerEmail: 'victim@example.com' }),
      )
      expect(res.status).toBe(401)
      expect(getCardTokenByEmailMock).not.toHaveBeenCalled()
    })

    it('DELETE saved-card → 401, store never deleted', async () => {
      const res = await savedCardDelete(
        jsonRequest('DELETE', { customerEmail: 'victim@example.com' }),
      )
      expect(res.status).toBe(401)
      expect(deleteCardTokenMock).not.toHaveBeenCalled()
    })

    it('charge-token → 401, provider never called', async () => {
      const res = await chargeTokenPost(
        jsonRequest('POST', {
          amountRub: 1000,
          customerEmail: 'victim@example.com',
          personalDataConsentAccepted: true,
        }),
      )
      expect(res.status).toBe(401)
      expect(chargeWithSavedCardMock).not.toHaveBeenCalled()
    })
  })

  describe('authenticated caller', () => {
    beforeEach(() => {
      getCurrentSessionMock.mockResolvedValue({
        account: { id: 'acct-1', email: 'real-owner@example.com' },
        session: { id: 'sess-1' },
      })
    })

    it('GET saved-card uses session email, NOT body.customerEmail', async () => {
      getCardTokenByEmailMock.mockResolvedValue(null)
      const res = await savedCardPost(
        jsonRequest('POST', { customerEmail: 'victim@example.com' }),
      )
      expect(res.status).toBe(200)
      expect(getCardTokenByEmailMock).toHaveBeenCalledWith('real-owner@example.com')
      expect(getCardTokenByEmailMock).not.toHaveBeenCalledWith('victim@example.com')
    })

    it('DELETE saved-card uses session email, NOT body.customerEmail', async () => {
      const res = await savedCardDelete(
        jsonRequest('DELETE', { customerEmail: 'victim@example.com' }),
      )
      expect(res.status).toBe(200)
      expect(deleteCardTokenMock).toHaveBeenCalledWith('real-owner@example.com')
      expect(deleteCardTokenMock).not.toHaveBeenCalledWith('victim@example.com')
    })

    it('charge-token charges the SESSION email, NOT body.customerEmail', async () => {
      chargeWithSavedCardMock.mockResolvedValue({ kind: 'no_saved_card' })
      const res = await chargeTokenPost(
        jsonRequest('POST', {
          amountRub: 1000,
          customerEmail: 'victim@example.com',
          personalDataConsentAccepted: true,
        }),
      )
      expect(res.status).toBe(404)
      expect(chargeWithSavedCardMock).toHaveBeenCalledTimes(1)
      const args = chargeWithSavedCardMock.mock.calls[0][0]
      expect(args.customerEmail).toBe('real-owner@example.com')
      expect(args.customerEmail).not.toBe('victim@example.com')
    })
  })
})
