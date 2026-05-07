import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Wave 2.2 — secondary rate limit on CloudPayments webhooks.
//
// The HMAC-only gate that existed before would let a leaked-key
// attacker flood the webhook handler with valid-signature requests
// (we'd run markOrderPaid, fire emails, allocate slots, etc). The
// secondary IP-keyed bucket caps that flood at 60/min/kind/IP.
// Legitimate CloudPayments retries sit ~1000x below the ceiling.

import {
  __resetRateLimitsForTesting,
  takeRateLimit,
} from '@/lib/security/rate-limit'

vi.mock('@/lib/audit/payment-events', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/audit/payment-events')
  >('@/lib/audit/payment-events')
  return {
    ...actual,
    recordPaymentAuditEvent: vi.fn().mockResolvedValue(true),
  }
})

vi.mock('@/lib/payments/webhook-dedup', () => ({
  ensureWebhookDeliveriesSchema: vi.fn().mockResolvedValue(undefined),
  lookupWebhookDelivery: vi.fn().mockResolvedValue(null),
  recordWebhookDelivery: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/payments/config', () => ({
  paymentConfig: {
    storageBackend: 'file',
    cloudpayments: { publicId: 'test', apiSecret: 'test' },
  },
  isCloudPaymentsConfigured: () => true,
}))

vi.mock('@/lib/payments/cloudpayments-webhook', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/payments/cloudpayments-webhook')
  >('@/lib/payments/cloudpayments-webhook')
  return {
    ...actual,
    verifyCloudPaymentsSignature: vi.fn(() => true),
    parseCloudPaymentsPayload: vi.fn(() => ({
      InvoiceId: 'lc_test12345678',
      Amount: '1000',
      Email: 'a@b.com',
      TransactionId: 999,
    })),
    getCloudPaymentsInvoiceId: vi.fn(() => 'lc_test12345678'),
    validateCloudPaymentsOrder: vi.fn(async () => ({ ok: true as const })),
  }
})

vi.mock('@/lib/payments/store', () => ({
  getOrder: vi.fn(async () => null),
  listOrders: vi.fn(),
  createOrder: vi.fn(),
  updateOrder: vi.fn(),
  getCardTokenByEmail: vi.fn(),
  persistCardToken: vi.fn(),
  deleteCardTokenByEmail: vi.fn(),
  touchCardTokenUsedAt: vi.fn(),
}))

import { handleCloudPaymentsWebhook } from '@/lib/payments/cloudpayments-route'
import { verifyCloudPaymentsSignature } from '@/lib/payments/cloudpayments-webhook'

const verifyMock = verifyCloudPaymentsSignature as unknown as ReturnType<
  typeof vi.fn
>

const originalDatabaseUrl = process.env.DATABASE_URL

function reqFromIp(ip: string): Request {
  return new Request('https://example.com/webhook', {
    method: 'POST',
    body: '{}',
    headers: {
      'content-type': 'application/json',
      'x-content-hmac': 'whatever',
      'x-forwarded-for': ip,
    },
  })
}

describe('handleCloudPaymentsWebhook — secondary rate limit', () => {
  beforeEach(() => {
    delete process.env.DATABASE_URL // force in-memory bucket
    __resetRateLimitsForTesting()
    verifyMock.mockReturnValue(true)
  })

  afterEach(() => {
    if (originalDatabaseUrl !== undefined) {
      process.env.DATABASE_URL = originalDatabaseUrl
    }
    vi.clearAllMocks()
  })

  it('legitimate cadence (under 60/min) all pass', async () => {
    for (let i = 0; i < 10; i += 1) {
      const res = await handleCloudPaymentsWebhook(reqFromIp('1.2.3.4'), {
        kind: 'pay',
        handler: vi.fn(),
      })
      expect(res.status).toBe(200)
      expect((await res.json()).code).toBe(0)
    }
  })

  it('61st request from the same IP within a minute is 429', async () => {
    for (let i = 0; i < 60; i += 1) {
      const res = await handleCloudPaymentsWebhook(reqFromIp('5.6.7.8'), {
        kind: 'pay',
        handler: vi.fn(),
      })
      expect(res.status).toBe(200)
    }
    const blocked = await handleCloudPaymentsWebhook(reqFromIp('5.6.7.8'), {
      kind: 'pay',
      handler: vi.fn(),
    })
    expect(blocked.status).toBe(429)
    expect(blocked.headers.get('Retry-After')).toBeTruthy()
  })

  it('different IPs have independent buckets', async () => {
    // Fill IP A's bucket.
    for (let i = 0; i < 60; i += 1) {
      const res = await handleCloudPaymentsWebhook(reqFromIp('9.9.9.9'), {
        kind: 'pay',
        handler: vi.fn(),
      })
      expect(res.status).toBe(200)
    }

    // IP B is unaffected.
    const fromB = await handleCloudPaymentsWebhook(reqFromIp('8.8.8.8'), {
      kind: 'pay',
      handler: vi.fn(),
    })
    expect(fromB.status).toBe(200)
  })

  it('different kinds (check vs pay) have independent buckets', async () => {
    // Fill the `pay` bucket for an IP.
    for (let i = 0; i < 60; i += 1) {
      const res = await handleCloudPaymentsWebhook(reqFromIp('7.7.7.7'), {
        kind: 'pay',
        handler: vi.fn(),
      })
      expect(res.status).toBe(200)
    }

    // `check` from the same IP is its own bucket — passes.
    const fromCheck = await handleCloudPaymentsWebhook(reqFromIp('7.7.7.7'), {
      kind: 'check',
      handler: vi.fn(),
    })
    expect(fromCheck.status).toBe(200)
  })

  it('HMAC-fail does not consume bucket (unauth flood is free)', async () => {
    verifyMock.mockReturnValue(false)
    const ip = '4.4.4.4'

    // 200 unauth attempts — all 401, none consume the bucket.
    for (let i = 0; i < 200; i += 1) {
      const res = await handleCloudPaymentsWebhook(reqFromIp(ip), {
        kind: 'pay',
        handler: vi.fn(),
      })
      expect(res.status).toBe(401)
    }

    // Bucket should still be empty when a legitimate (HMAC-valid)
    // CloudPayments retry arrives from the same IP. We probe with
    // takeRateLimit directly to assert no bucket consumption.
    const result = await takeRateLimit(
      `webhook:cloudpayments:pay:ip:${ip}`,
      60,
      60_000,
    )
    expect(result.remaining).toBe(59) // first take, full budget
  })
})
