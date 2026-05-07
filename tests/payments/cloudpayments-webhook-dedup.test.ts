import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Wave 1.2 (security) — webhook delivery dedup tests.
// Wave 2.3 (security) — request-fingerprint additions.
//
// Pins the contract:
//   1. First delivery for (provider, kind, txId) runs the handler and
//      records the response + fingerprint.
//   2. Duplicate delivery (same triple, same fingerprint) returns the
//      cached response with `Webhook-Replay: true` header and does NOT
//      re-run the handler.
//   3. Different TransactionId is treated as a separate delivery.
//   4. Missing TransactionId falls through (no dedup key).
//   5. HMAC failure stops the request before dedup is consulted.
//   6. Wave 2.3: fingerprint mismatch on cache hit forces re-run.

const recordPaymentAuditEventMock = vi.fn().mockResolvedValue(true)
const ensureWebhookDeliveriesSchemaMock = vi.fn().mockResolvedValue(undefined)
const lookupWebhookDeliveryMock = vi.fn()
const recordWebhookDeliveryMock = vi.fn().mockResolvedValue(undefined)

// Wave 3.2 — the route now goes through `pool.connect()` + client
// transaction + advisory_xact_lock for dedup-enabled cases. We mock
// pool.connect to return a stub client that no-ops the BEGIN /
// pg_advisory_xact_lock / COMMIT / release sequence, and we wire the
// client variants of lookup/record to the SAME mocks as the pool
// variants so existing assertions still see calls.
const clientQueryMock = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 })
const clientReleaseMock = vi.fn()
const poolConnectMock = vi.fn().mockResolvedValue({
  query: clientQueryMock,
  release: clientReleaseMock,
})

vi.mock('@/lib/db/pool', async () => {
  const actual = await vi.importActual<typeof import('@/lib/db/pool')>(
    '@/lib/db/pool',
  )
  return {
    ...actual,
    // Override only the throw-on-missing variant; the OrNull /
    // resolveSslConfig / getHealthProbePool surfaces stay real.
    getDbPool: () => ({ connect: poolConnectMock }),
  }
})

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
  // Client variants delegate to the same mocks (the route's serialized
  // path passes the stub client as args[0]; we ignore it and forward
  // the rest so existing assertions continue to work).
  lookupWebhookDeliveryClient: (_client: unknown, ...rest: unknown[]) =>
    lookupWebhookDeliveryMock(...rest),
  recordWebhookDeliveryClient: (_client: unknown, opts: unknown) =>
    recordWebhookDeliveryMock(opts),
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
    // Read invoice straight from the parsed payload so tests that
    // change the InvoiceId field flow through to the fingerprint.
    getCloudPaymentsInvoiceId: vi.fn(
      (payload: { InvoiceId?: unknown }) =>
        typeof payload?.InvoiceId === 'string' ? payload.InvoiceId : null,
    ),
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
    clientQueryMock.mockClear()
    clientQueryMock.mockResolvedValue({ rows: [], rowCount: 0 })
    clientReleaseMock.mockClear()
    poolConnectMock.mockClear()
    poolConnectMock.mockResolvedValue({
      query: clientQueryMock,
      release: clientReleaseMock,
    })
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

  it('first delivery runs the handler and records the response with a fingerprint', async () => {
    lookupWebhookDeliveryMock.mockResolvedValue({ kind: 'miss' })
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
      expect.stringMatching(/^[a-f0-9]{64}$/),
    )

    expect(recordWebhookDeliveryMock).toHaveBeenCalledOnce()
    const recorded = recordWebhookDeliveryMock.mock.calls[0][0]
    expect(recorded).toMatchObject({
      provider: 'cloudpayments',
      kind: 'pay',
      transactionId: '999',
      invoiceId: 'lc_test12345678',
      outcome: { status: 200, body: { code: 0 } },
    })
    expect(recorded.requestFingerprint).toMatch(/^[a-f0-9]{64}$/)
  })

  it('duplicate delivery (kind:hit) returns cached response with Webhook-Replay header', async () => {
    lookupWebhookDeliveryMock.mockResolvedValue({
      kind: 'hit',
      outcome: { status: 200, body: { code: 0 } },
    })
    const handler = vi.fn()

    const res = await handleCloudPaymentsWebhook(fakeRequest(), {
      kind: 'pay',
      handler,
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ code: 0 })
    expect(res.headers.get('Webhook-Replay')).toBe('true')

    expect(handler).not.toHaveBeenCalled()
    expect(recordPaymentAuditEventMock).not.toHaveBeenCalled()
    expect(recordWebhookDeliveryMock).not.toHaveBeenCalled()
  })

  it('Wave 2.3: fingerprint_mismatch on cache hit re-runs the handler and warns', async () => {
    lookupWebhookDeliveryMock.mockResolvedValue({
      kind: 'fingerprint_mismatch',
      cachedFingerprint: 'a'.repeat(64),
    })
    const handler = vi.fn().mockResolvedValue(undefined)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const res = await handleCloudPaymentsWebhook(fakeRequest(), {
      kind: 'pay',
      handler,
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ code: 0 })

    // The cache was NOT trusted — handler ran.
    expect(handler).toHaveBeenCalledOnce()
    // The mismatch surfaced via console.warn so the operator can grep
    // for `[webhook-dedup] fingerprint mismatch`.
    expect(warn).toHaveBeenCalled()
    const matched = warn.mock.calls.some(
      (args) =>
        typeof args[0] === 'string' &&
        args[0].includes('fingerprint mismatch'),
    )
    expect(matched).toBe(true)
  })

  it('different kind is treated as separate delivery (check vs pay)', async () => {
    lookupWebhookDeliveryMock.mockResolvedValueOnce({ kind: 'miss' })
    lookupWebhookDeliveryMock.mockResolvedValueOnce({ kind: 'miss' })
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
      expect.any(String),
    )
    expect(lookupWebhookDeliveryMock).toHaveBeenNthCalledWith(
      2,
      'cloudpayments',
      'pay',
      '999',
      expect.any(String),
    )
  })

  // Codex 2026-05-07: a verified-HMAC webhook without TransactionId
  // can only be abuse — CloudPayments always sends one. The handler
  // pipeline must NOT run; the request is rejected at the entry guard.
  it('missing TransactionId is rejected (not allowed to fall through)', async () => {
    parseMock.mockReturnValue({
      InvoiceId: 'lc_test12345678',
      Amount: '1000',
      Email: 'a@b.com',
      // TransactionId omitted
    })
    const handler = vi.fn()

    const response = await handleCloudPaymentsWebhook(fakeRequest(), {
      kind: 'pay',
      handler,
    })

    expect(response.status).toBe(400)
    expect(handler).not.toHaveBeenCalled()
    expect(lookupWebhookDeliveryMock).not.toHaveBeenCalled()
    expect(recordWebhookDeliveryMock).not.toHaveBeenCalled()
  })

  it('blank-string TransactionId is rejected (treated as missing)', async () => {
    parseMock.mockReturnValue({
      InvoiceId: 'lc_test12345678',
      Amount: '1000',
      Email: 'a@b.com',
      TransactionId: '   ',
    })
    const handler = vi.fn()

    const response = await handleCloudPaymentsWebhook(fakeRequest(), {
      kind: 'pay',
      handler,
    })

    expect(response.status).toBe(400)
    expect(handler).not.toHaveBeenCalled()
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
    lookupWebhookDeliveryMock.mockResolvedValue({ kind: 'miss' })

    await handleCloudPaymentsWebhook(fakeRequest(), {
      kind: 'pay',
      handler: vi.fn(),
    })

    expect(lookupWebhookDeliveryMock).toHaveBeenCalledWith(
      'cloudpayments',
      'pay',
      '4242',
      expect.any(String),
    )
  })

  it('Wave 2.3: fingerprint depends on payload content (different invoices → different fps)', async () => {
    lookupWebhookDeliveryMock.mockResolvedValue({ kind: 'miss' })

    parseMock.mockReturnValueOnce({
      InvoiceId: 'lc_alpha',
      Amount: '1000',
      Email: 'a@b.com',
      TransactionId: 100,
    })
    await handleCloudPaymentsWebhook(fakeRequest(), {
      kind: 'pay',
      handler: vi.fn(),
    })

    parseMock.mockReturnValueOnce({
      InvoiceId: 'lc_beta', // different invoice
      Amount: '1000',
      Email: 'a@b.com',
      TransactionId: 100, // same TxId
    })
    await handleCloudPaymentsWebhook(fakeRequest(), {
      kind: 'pay',
      handler: vi.fn(),
    })

    const fp1 = lookupWebhookDeliveryMock.mock.calls[0][3]
    const fp2 = lookupWebhookDeliveryMock.mock.calls[1][3]
    expect(fp1).toMatch(/^[a-f0-9]{64}$/)
    expect(fp2).toMatch(/^[a-f0-9]{64}$/)
    expect(fp1).not.toBe(fp2)
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
    lookupWebhookDeliveryMock.mockResolvedValue({ kind: 'miss' })
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
    lookupWebhookDeliveryMock.mockResolvedValue({ kind: 'miss' })

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
