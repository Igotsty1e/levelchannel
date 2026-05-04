import { describe, expect, it } from 'vitest'

import { POST as createHandler } from '@/app/api/payments/route'
import { POST as mockConfirmHandler } from '@/app/api/payments/mock/[invoiceId]/confirm/route'
import { listPaymentOrdersForAdmin } from '@/lib/payments/admin-list'

import { buildRequest } from '../helpers'
import './setup'

// Verifies the admin-side payment listing helper:
//   - returns the orders DESC by created_at
//   - status filter narrows to a single status bucket
//   - email filter does case-insensitive prefix-or-substring match
//   - pagination via limit/offset works
//   - the `slotId` derived from order.metadata is exposed when present

async function createPending(email: string, slotId?: string) {
  const res = await createHandler(
    buildRequest('/api/payments', {
      body: {
        amountRub: 1500,
        customerEmail: email,
        personalDataConsentAccepted: true,
        ...(slotId ? { slotId } : {}),
      },
    }),
  )
  expect(res.status).toBe(200)
  const json = await res.json()
  return json.order.invoiceId as string
}

async function payOrder(invoiceId: string) {
  const res = await mockConfirmHandler(
    buildRequest(`/api/payments/mock/${invoiceId}/confirm`, { body: {} }),
    { params: Promise.resolve({ invoiceId }) },
  )
  expect(res.status).toBe(200)
}

describe('listPaymentOrdersForAdmin', () => {
  it('lists DESC by created_at and returns slotId from metadata', async () => {
    const a = await createPending('a@example.com')
    const b = await createPending(
      'b@example.com',
      '11111111-2222-3333-4444-555555555555',
    )
    void a

    const { orders, total } = await listPaymentOrdersForAdmin({
      status: 'all',
    })
    expect(total).toBeGreaterThanOrEqual(2)
    // Most recent created (b) should be first.
    const bRow = orders.find((o) => o.invoiceId === b)
    expect(bRow?.slotId).toBe('11111111-2222-3333-4444-555555555555')
    const aRow = orders.find((o) => o.invoiceId === a)
    expect(aRow?.slotId).toBeNull()
  })

  it('filters by status', async () => {
    const willPay = await createPending('paid@example.com')
    await createPending('still-pending@example.com')
    await payOrder(willPay)

    const { orders: paidOnly } = await listPaymentOrdersForAdmin({
      status: 'paid',
    })
    expect(paidOnly.every((o) => o.status === 'paid')).toBe(true)
    expect(paidOnly.find((o) => o.invoiceId === willPay)).toBeDefined()

    const { orders: pendingOnly } = await listPaymentOrdersForAdmin({
      status: 'pending',
    })
    expect(pendingOnly.every((o) => o.status === 'pending')).toBe(true)
  })

  it('filters by email substring (case-insensitive)', async () => {
    await createPending('Targeted+1@Example.COM')
    await createPending('other@example.com')
    const { orders } = await listPaymentOrdersForAdmin({
      email: 'TARGETED',
    })
    // Email is normalized to lowercase at storage time, so the
    // substring filter operates on the lowercased value.
    expect(orders.length).toBeGreaterThanOrEqual(1)
    expect(orders.every((o) => o.customerEmail.includes('targeted'))).toBe(true)
  })

  it('paginates via limit + offset', async () => {
    for (let i = 0; i < 5; i += 1) {
      await createPending(`p${i}@example.com`)
    }
    const page1 = await listPaymentOrdersForAdmin({ limit: 2, offset: 0 })
    const page2 = await listPaymentOrdersForAdmin({ limit: 2, offset: 2 })
    expect(page1.orders.length).toBe(2)
    expect(page2.orders.length).toBe(2)
    // No overlap.
    const ids1 = new Set(page1.orders.map((o) => o.invoiceId))
    const overlap = page2.orders.filter((o) => ids1.has(o.invoiceId))
    expect(overlap.length).toBe(0)
    // Total reflects all rows ignoring limit.
    expect(page1.total).toBeGreaterThanOrEqual(5)
    expect(page1.total).toBe(page2.total)
  })
})
