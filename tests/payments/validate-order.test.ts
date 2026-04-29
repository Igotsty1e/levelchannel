import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { PaymentOrder } from '@/lib/payments/types'

const orderFixture: PaymentOrder = {
  invoiceId: 'lc_test_abcd1234efgh',
  amountRub: 1000,
  currency: 'RUB',
  description: 'test',
  provider: 'cloudpayments',
  status: 'pending',
  createdAt: '2026-04-29T00:00:00.000Z',
  updatedAt: '2026-04-29T00:00:00.000Z',
  customerEmail: 'user@example.com',
  receiptEmail: 'user@example.com',
  receipt: {
    items: [],
    email: 'user@example.com',
    isBso: false,
    amounts: { electronic: 1000, advancePayment: 0, credit: 0, provision: 0 },
  },
  events: [],
}

const getOrderMock = vi.fn<(id: string) => Promise<PaymentOrder | undefined>>()

vi.mock('@/lib/payments/store', async () => {
  return {
    getOrder: (id: string) => getOrderMock(id),
    // другие методы store нам тут не нужны, но shim чтобы импорт не падал
    listOrders: vi.fn(),
    createOrder: vi.fn(),
    updateOrder: vi.fn(),
    getCardTokenByEmail: vi.fn(),
    upsertCardToken: vi.fn(),
    touchCardTokenUsedAt: vi.fn(),
    deleteCardToken: vi.fn(),
  }
})

const { validateCloudPaymentsOrder } = await import('@/lib/payments/cloudpayments-webhook')

beforeEach(() => {
  getOrderMock.mockReset()
})

describe('validateCloudPaymentsOrder', () => {
  it('rejects payload without InvoiceId', async () => {
    const result = await validateCloudPaymentsOrder({})
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe(10)
    }
  })

  it('rejects when order is unknown', async () => {
    getOrderMock.mockResolvedValueOnce(undefined)
    const result = await validateCloudPaymentsOrder({ InvoiceId: 'lc_unknown_123' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe(10)
    }
  })

  it('rejects amount mismatch', async () => {
    getOrderMock.mockResolvedValueOnce(orderFixture)
    const result = await validateCloudPaymentsOrder({
      InvoiceId: orderFixture.invoiceId,
      Amount: 999,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe(12)
    }
  })

  it('rejects when AccountId mismatches order email', async () => {
    getOrderMock.mockResolvedValueOnce(orderFixture)
    const result = await validateCloudPaymentsOrder({
      InvoiceId: orderFixture.invoiceId,
      Amount: 1000,
      AccountId: 'attacker@example.com',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe(11)
    }
  })

  it('rejects when Email mismatches order email', async () => {
    getOrderMock.mockResolvedValueOnce(orderFixture)
    const result = await validateCloudPaymentsOrder({
      InvoiceId: orderFixture.invoiceId,
      Amount: 1000,
      Email: 'someone-else@example.com',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe(11)
    }
  })

  it('rejects mock-provider orders accidentally arriving at CP webhook', async () => {
    getOrderMock.mockResolvedValueOnce({ ...orderFixture, provider: 'mock' })
    const result = await validateCloudPaymentsOrder({
      InvoiceId: orderFixture.invoiceId,
      Amount: 1000,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe(10)
    }
  })

  it('accepts a valid payload', async () => {
    getOrderMock.mockResolvedValueOnce(orderFixture)
    const result = await validateCloudPaymentsOrder({
      InvoiceId: orderFixture.invoiceId,
      Amount: 1000,
      AccountId: orderFixture.customerEmail,
      Email: orderFixture.customerEmail,
    })
    expect(result.ok).toBe(true)
  })
})
