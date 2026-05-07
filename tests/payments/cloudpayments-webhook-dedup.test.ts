import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Wave 1 (security) — webhook delivery dedup tests.
//
// Pins the contract:
//   1. First delivery for (provider, kind, txId) runs the handler and
//      records the response.
//   2. Duplicate delivery (same triple) returns the cached response
//      with `Webhook-Replay: true` header and does NOT re-run the
//      handler — no duplicate audit, no duplicate side effects.
//   3. Different TransactionId is treated as a separate delivery.
//   4. Missing TransactionId falls through (no dedup key, handler
//      runs as before).
//   5. HMAC failure stops the request before dedup is consulted.

const recordPaymentAuditEventMock = vi.fn().mockResolvedValue(true)
const ensureWebhookDeliveriesSchemaMock = vi.fn().mockResolvedValue(undefined)
const lookupWebhookDeliveryMock = vi.fn()
const recordWebhookDeliveryMock = vi.fn().mockResolvedValue(undefined)

vi.mock('@/lib/audit/payment-events', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/audit/payment-events')
  >('@/lib/audit/payment-events')
  return {
    ...actual,
    recordPaymentAuditEvent: (...args: unknown[]) =>
      recordPaymentAuditEventMock(...args),
  }
})

vi.mock('@/lib/payments/webhook-dedup', () => ({
  ensureWebhookDeliveriesSchema: () => ensureWebhookDeliveriesSchemaMock(),
  lookupWebhookDelivery: (...args: unknown[]) =>
    lookupWebhookDeliveryMock(...args),
  recordWebhookDelivery: (...args: unknown[]) =>
    recordWebhookDeliveryMock(...args),
}))

vi.mock('@/lib/payments/config', () => ({
  paymentConfig: {
    storageBackend: 'postgres',
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
  getOrder: vi.fn(async () => ({
    invoiceId: 'lc_test12345678',
    amountRub: 10,
    customerEmail: 'a@b.com',
    receiptEmail: 'a@b.com',
    currency: 'RUB',
    description: 'Test',
    provider: 'cloudpayments' as const,
    status: 'pending' as const,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    paidAt: null,
    failedAt: null,
    providerTransactionId: null,
    providerMessage: null,
    receipt: {} as Record<string, unknown>,
    metadata: null,
    mockAutoConfirmAt: null,
    events: [],
  })),
  listOrders: vi.fn(),
  createOrder: vi.fn(),
  updateOrder: vi.fn(),
  getCardTokenByEmail: vi.fn(),
  persistCardToken: vi.fn(),
  deleteCardTokenByEmail: vi.fn(),
  touchCardTokenUsedAt: vi.fn(),
}))

import { handleCloudPaymentsWebhook } from '@/lib/payments/cloudpayments-route'
import {
  parseCloudPaymentsPayload,
  verifyCloudPaymentsSignature,
} from '@/lib/payments/cloudpayments-webhook'

const verifyMock = verifyCloudPaymentsSignature as unknown as ReturnType<
  typeof vi.fn
>
const parseMock = parseCloudPaymentsPayload as unknown as ReturnType<
  typeof vi.fn
>

function fakeRequest(): Request {
  return new Request('https://example.com/webhook', {
    method: 'POST',
    body: '{}',
    headers: {
      'content-type': 'application/json',
      'x-content-hmac': 'whatever',
    },
  })
}

describe('handleCloudPaymentsWebhook — delivery dedup', () => {
  beforeEach(() => {
    recordPaymentAuditEventMock.mockClear()
    ensureWebhookDeliveriesSchemaMock.mockClear()
    lookupWebhookDeliveryMock.mockReset()
    recordWebhookDeliveryMock.mockClear()
    verifyMock.mockReturnValue(true)
    parseMock.mockReturnValue({
      InvoiceId: 'lc_test12345678',
      Amount: '1000',
      Email: 'a@b.com',
      TransactionId: 999,
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('first delivery runs the handler and records the response', async () => {
    lookupWebhookDeliveryMock.mockResolvedValue(null)
    const handler = vi.fn().mockResolvedValue(undefined)

    const res = await handleCloudPaymentsWebhook(fakeRequest(), {
      kind: 'pay',
      handler,
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ code: 0 })
    expect(handler).toHaveBeenCalledOnce()

    expect(lookupWebhookDeliveryMock).toHaveBeenCalledOnce()
    expect(lookupWebhookDeliveryMock).toHaveBeenCalledWith(
      'cloudpayments',
      'pay',
      '999',
    )

    expect(recordWebhookDeliveryMock).toHaveBeenCalledOnce()
    expect(recordWebhookDeliveryMock.mock.calls[0][0]).toMatchObject({
      provider: 'cloudpayments',
      kind: 'pay',
      transactionId: '999',
      invoiceId: 'lc_test12345678',
      outcome: { status: 200, body: { code: 0 } },
    })
  })

  it('duplicate delivery returns cached response with Webhook-Replay header', async () => {
    lookupWebhookDeliveryMock.mockResolvedValue({
      status: 200,
      body: { code: 0 },
    })
    const handler = vi.fn()

    const res = await handleCloudPaymentsWebhook(fakeRequest(), {
      kind: 'pay',
      handler,
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ code: 0 })
    expect(res.headers.get('Webhook-Replay')).toBe('true')

    // Critical: the handler MUST NOT run on a replay.
    expect(handler).not.toHaveBeenCalled()

    // No new audit row, no new dedup row.
    expect(recordPaymentAuditEventMock).not.toHaveBeenCalled()
    expect(recordWebhookDeliveryMock).not.toHaveBeenCalled()
  })

  it('different kind is treated as separate delivery (check vs pay)', async () => {
    lookupWebhookDeliveryMock.mockResolvedValueOnce(null)
    lookupWebhookDeliveryMock.mockResolvedValueOnce(null)
    const checkHandler = vi.fn()
    const payHandler = vi.fn()

    await handleCloudPaymentsWebhook(fakeRequest(), {
      kind: 'check',
      handler: checkHandler,
    })
    await handleCloudPaymentsWebhook(fakeRequest(), {
      kind: 'pay',
      handler: payHandler,
    })

    expect(checkHandler).toHaveBeenCalledOnce()
    expect(payHandler).toHaveBeenCalledOnce()

    expect(lookupWebhookDeliveryMock).toHaveBeenNthCalledWith(
      1,
      'cloudpayments',
      'check',
      '999',
    )
    expect(lookupWebhookDeliveryMock).toHaveBeenNthCalledWith(
      2,
      'cloudpayments',
      'pay',
      '999',
    )
  })

  it('missing TransactionId falls through with no dedup', async () => {
    parseMock.mockReturnValue({
      InvoiceId: 'lc_test12345678',
      Amount: '1000',
      Email: 'a@b.com',
      // TransactionId omitted
    })
    const handler = vi.fn()

    await handleCloudPaymentsWebhook(fakeRequest(), {
      kind: 'pay',
      handler,
    })

    expect(handler).toHaveBeenCalledOnce()

    // No dedup lookup, no dedup persist — there's no key to dedup on.
    expect(lookupWebhookDeliveryMock).not.toHaveBeenCalled()
    expect(recordWebhookDeliveryMock).not.toHaveBeenCalled()
  })

  it('empty-string TransactionId is treated as missing', async () => {
    parseMock.mockReturnValue({
      InvoiceId: 'lc_test12345678',
      Amount: '1000',
      Email: 'a@b.com',
      TransactionId: '   ',
    })
    const handler = vi.fn()

    await handleCloudPaymentsWebhook(fakeRequest(), {
      kind: 'pay',
      handler,
    })

    expect(handler).toHaveBeenCalledOnce()
    expect(lookupWebhookDeliveryMock).not.toHaveBeenCalled()
    expect(recordWebhookDeliveryMock).not.toHaveBeenCalled()
  })

  it('numeric TransactionId is normalised to string for dedup key', async () => {
    parseMock.mockReturnValue({
      InvoiceId: 'lc_test12345678',
      Amount: '1000',
      Email: 'a@b.com',
      TransactionId: 4242,
    })
    lookupWebhookDeliveryMock.mockResolvedValue(null)

    await handleCloudPaymentsWebhook(fakeRequest(), {
      kind: 'pay',
      handler: vi.fn(),
    })

    expect(lookupWebhookDeliveryMock).toHaveBeenCalledWith(
      'cloudpayments',
      'pay',
      '4242',
    )
  })

  it('HMAC failure short-circuits before dedup is consulted', async () => {
    verifyMock.mockReturnValue(false)
    const handler = vi.fn()

    const res = await handleCloudPaymentsWebhook(fakeRequest(), {
      kind: 'pay',
      handler,
    })

    expect(res.status).toBe(401)
    expect(handler).not.toHaveBeenCalled()
    expect(lookupWebhookDeliveryMock).not.toHaveBeenCalled()
    expect(recordWebhookDeliveryMock).not.toHaveBeenCalled()
  })

  it('dedup persist failure does not block the webhook ack', async () => {
    lookupWebhookDeliveryMock.mockResolvedValue(null)
    recordWebhookDeliveryMock.mockRejectedValueOnce(new Error('pg down'))
    const handler = vi.fn()

    const res = await handleCloudPaymentsWebhook(fakeRequest(), {
      kind: 'pay',
      handler,
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ code: 0 })
    expect(handler).toHaveBeenCalledOnce()
  })

  it('dedup lookup failure falls through to legacy path', async () => {
    lookupWebhookDeliveryMock.mockRejectedValueOnce(new Error('pg lookup down'))
    const handler = vi.fn()

    const res = await handleCloudPaymentsWebhook(fakeRequest(), {
      kind: 'pay',
      handler,
    })

    expect(res.status).toBe(200)
    expect(handler).toHaveBeenCalledOnce()
  })

  it('caches the validation-failed response, not just success', async () => {
    const { validateCloudPaymentsOrder } = await import(
      '@/lib/payments/cloudpayments-webhook'
    )
    ;(validateCloudPaymentsOrder as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ ok: false, code: 11 })
    lookupWebhookDeliveryMock.mockResolvedValue(null)

    const res = await handleCloudPaymentsWebhook(fakeRequest(), {
      kind: 'pay',
      handler: vi.fn(),
    })

    expect(await res.json()).toEqual({ code: 11 })
    expect(recordWebhookDeliveryMock).toHaveBeenCalledOnce()
    expect(recordWebhookDeliveryMock.mock.calls[0][0]).toMatchObject({
      outcome: { status: 200, body: { code: 11 } },
    })
  })
})
