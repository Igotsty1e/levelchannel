import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { PaymentOrder } from '@/lib/payments/types'

// SBP-PAY (2026-05-19) — pins the lifecycle contract per §0b BLOCKER#3
// closure:
//   - If the order already has paymentMethod set (canonical at
//     create-qr time), markOrderPaid KEEPS that value — webhook does
//     NOT overwrite.
//   - If the order has paymentMethod=null (legacy / migration-edge),
//     markOrderPaid fills it in ONLY when detectedPaymentMethod is
//     a positive 'card'/'sbp' classification.
//   - 'unknown' detection NEVER overwrites — column stays null until
//     operator reconciliation.
//
// We mock the store so the test runs hermetic (no DB) and the
// behaviour is fully observable via the updater callback.

// Holds the most-recent in-memory order; the mocked updateOrder
// closure mutates it via the updater callback.
let storedOrder: PaymentOrder | null = null

vi.mock('@/lib/payments/store', () => ({
  getOrder: vi.fn(async (_invoiceId: string) => storedOrder),
  updateOrder: vi.fn(
    async (
      _invoiceId: string,
      updater: (order: PaymentOrder) => PaymentOrder,
    ) => {
      if (!storedOrder) return null
      storedOrder = updater(storedOrder)
      return storedOrder
    },
  ),
}))

vi.mock('@/lib/payments/status-bus', () => ({
  emitStatusChange: vi.fn(),
}))

// Imported AFTER vi.mock so internal imports resolve to mocks.
const { markOrderPaid } = await import('@/lib/payments/provider/lifecycle')

function makeOrder(overrides: Partial<PaymentOrder> = {}): PaymentOrder {
  return {
    invoiceId: 'lc_test1234567890',
    amountRub: 3500,
    currency: 'RUB',
    description: 'test',
    provider: 'cloudpayments',
    status: 'pending',
    createdAt: '2026-05-19T00:00:00.000Z',
    updatedAt: '2026-05-19T00:00:00.000Z',
    customerEmail: 'u@example.com',
    receiptEmail: 'u@example.com',
    receipt: {
      items: [],
      email: 'u@example.com',
      isBso: false,
      amounts: {
        electronic: 0,
        advancePayment: 0,
        credit: 0,
        provision: 0,
      },
    },
    events: [],
    ...overrides,
  }
}

beforeEach(() => {
  storedOrder = null
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('markOrderPaid + detectedPaymentMethod (§0b BLOCKER#3)', () => {
  it('KEEPS canonical paymentMethod="sbp" when detected="card" (race-safety)', async () => {
    storedOrder = makeOrder({ paymentMethod: 'sbp' })
    const result = await markOrderPaid(
      storedOrder.invoiceId,
      {},
      { detectedPaymentMethod: 'card' },
    )
    expect(result?.paymentMethod).toBe('sbp')
    expect(result?.status).toBe('paid')
  })

  it('KEEPS canonical paymentMethod="card" when detected="sbp"', async () => {
    storedOrder = makeOrder({ paymentMethod: 'card' })
    const result = await markOrderPaid(
      storedOrder.invoiceId,
      {},
      { detectedPaymentMethod: 'sbp' },
    )
    expect(result?.paymentMethod).toBe('card')
  })

  it('FILLS paymentMethod when order.paymentMethod==null and detected="sbp"', async () => {
    storedOrder = makeOrder({ paymentMethod: null })
    const result = await markOrderPaid(
      storedOrder.invoiceId,
      {},
      { detectedPaymentMethod: 'sbp' },
    )
    expect(result?.paymentMethod).toBe('sbp')
  })

  it('FILLS paymentMethod when order.paymentMethod==null and detected="card"', async () => {
    storedOrder = makeOrder({ paymentMethod: null })
    const result = await markOrderPaid(
      storedOrder.invoiceId,
      {},
      { detectedPaymentMethod: 'card' },
    )
    expect(result?.paymentMethod).toBe('card')
  })

  it('KEEPS paymentMethod==null when detected="unknown" (operator reconciles)', async () => {
    storedOrder = makeOrder({ paymentMethod: null })
    const result = await markOrderPaid(
      storedOrder.invoiceId,
      {},
      { detectedPaymentMethod: 'unknown' },
    )
    expect(result?.paymentMethod).toBeNull()
  })

  it('KEEPS paymentMethod==null when opts.detectedPaymentMethod is absent', async () => {
    // Backward-compatibility: existing call-sites that don't pass the
    // opts.detectedPaymentMethod (mock-confirm route, charge-token
    // path) MUST not have their behaviour changed.
    storedOrder = makeOrder({ paymentMethod: null })
    const result = await markOrderPaid(storedOrder.invoiceId, {})
    expect(result?.paymentMethod).toBeNull()
  })

  it('paid_duplicate path: idempotent re-call does NOT overwrite an already-paid order', async () => {
    storedOrder = makeOrder({ paymentMethod: 'sbp', status: 'paid' })
    const result = await markOrderPaid(
      storedOrder.invoiceId,
      {},
      { detectedPaymentMethod: 'card' },
    )
    // Order stays paid + the canonical method stays 'sbp'. The
    // duplicate-event branch returns appendEvent(...payment.paid_duplicate)
    // without rewriting paymentMethod.
    expect(result?.status).toBe('paid')
    expect(result?.paymentMethod).toBe('sbp')
  })
})
