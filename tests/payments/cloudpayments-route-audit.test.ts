import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the audit recorder to observe its calls. The wrapper itself
// is what we're testing — that it pipes the right phase event for
// each kind, and that validation failure produces the matching
// `.declined` / `.validation_failed` event.

const recordPaymentAuditEventMock = vi.fn().mockResolvedValue(true)

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
    validateCloudPaymentsOrder: vi.fn(),
  }
})

vi.mock('@/lib/payments/store', async () => {
  return {
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
  }
})

import { handleCloudPaymentsWebhook } from '@/lib/payments/cloudpayments-route'
import { validateCloudPaymentsOrder } from '@/lib/payments/cloudpayments-webhook'

const validateMock = validateCloudPaymentsOrder as unknown as ReturnType<
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

describe('handleCloudPaymentsWebhook — audit phase coverage', () => {
  beforeEach(() => {
    recordPaymentAuditEventMock.mockClear()
    validateMock.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('writes pay.received then pay.validation_failed when validation rejects', async () => {
    validateMock.mockResolvedValue({ ok: false, code: 11 })
    const handler = vi.fn()

    const res = await handleCloudPaymentsWebhook(fakeRequest(), {
      kind: 'pay',
      handler,
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ code: 11 })
    expect(handler).not.toHaveBeenCalled()

    expect(recordPaymentAuditEventMock).toHaveBeenCalledTimes(2)
    expect(recordPaymentAuditEventMock.mock.calls[0][0].eventType).toBe(
      'webhook.pay.received',
    )
    expect(recordPaymentAuditEventMock.mock.calls[1][0].eventType).toBe(
      'webhook.pay.validation_failed',
    )
    expect(recordPaymentAuditEventMock.mock.calls[1][0].payload).toEqual({
      code: 11,
    })
  })

  it('writes only check.received then no decline when validation passes', async () => {
    validateMock.mockResolvedValue({ ok: true })
    const handler = vi.fn()

    await handleCloudPaymentsWebhook(fakeRequest(), { kind: 'check', handler })

    // Phase 0 only — no `webhook.check.declined` because validation
    // passed. handler was provided but Check route normally has no
    // handler; here we still pass it to make sure the wrapper calls
    // it on the success path.
    expect(handler).toHaveBeenCalledOnce()
    expect(recordPaymentAuditEventMock).toHaveBeenCalledTimes(1)
    expect(recordPaymentAuditEventMock.mock.calls[0][0].eventType).toBe(
      'webhook.check.received',
    )
  })

  it('writes fail.received then fail.declined for fail webhook on already-paid order', async () => {
    validateMock.mockResolvedValue({ ok: false, code: 12 })
    const handler = vi.fn()

    await handleCloudPaymentsWebhook(fakeRequest(), { kind: 'fail', handler })

    expect(handler).not.toHaveBeenCalled()
    expect(recordPaymentAuditEventMock).toHaveBeenCalledTimes(2)
    expect(recordPaymentAuditEventMock.mock.calls[0][0].eventType).toBe(
      'webhook.fail.received',
    )
    expect(recordPaymentAuditEventMock.mock.calls[1][0].eventType).toBe(
      'webhook.fail.declined',
    )
  })

  it('records actor as webhook:cloudpayments:<kind> on every phase event', async () => {
    validateMock.mockResolvedValue({ ok: true })

    await handleCloudPaymentsWebhook(fakeRequest(), { kind: 'pay' })
    expect(recordPaymentAuditEventMock.mock.calls[0][0].actor).toBe(
      'webhook:cloudpayments:pay',
    )

    recordPaymentAuditEventMock.mockClear()
    validateMock.mockResolvedValue({ ok: false, code: 13 })
    await handleCloudPaymentsWebhook(fakeRequest(), { kind: 'check' })
    expect(recordPaymentAuditEventMock.mock.calls[0][0].actor).toBe(
      'webhook:cloudpayments:check',
    )
    expect(recordPaymentAuditEventMock.mock.calls[1][0].actor).toBe(
      'webhook:cloudpayments:check',
    )
  })
})
