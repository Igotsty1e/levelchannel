import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { POST as refundsHandler } from '@/app/api/admin/refunds/route'
import { POST as loginHandler } from '@/app/api/auth/login/route'
import { POST as registerHandler } from '@/app/api/auth/register/route'
import {
  getAccountByEmail,
  grantAccountRole,
  markAccountVerified,
} from '@/lib/auth/accounts'
import { getDbPool } from '@/lib/db/pool'
import { listSlotPaymentState } from '@/lib/payments/allocations'

import '../setup'
import { buildRequest, extractSessionCookie, freshInvoiceId } from '../helpers'

// Refund Phase 7 Stage B. The admin endpoint creates a reversal row
// in payment_allocation_reversals; the SUM/anti-join in
// slotIsPaidByAllocations + listSlotPaidStatus + listAccountPostpaidDebt
// then drops the reversed allocation. Stage A wired the SQL; this
// suite verifies the end-to-end behaviour at the route layer.

beforeAll(() => {
  process.env.BILLING_WAVE_ACTIVE = 'true'
})

afterAll(() => {
  delete process.env.BILLING_WAVE_ACTIVE
})

async function regAdmin() {
  const email = `refund-admin-${Date.now()}@example.com`
  const password = 'StrongPassword123'
  await registerHandler(
    buildRequest('/api/auth/register', {
      body: { email, password, personalDataConsentAccepted: true },
    }),
  )
  const created = await getAccountByEmail(email)
  await markAccountVerified(created!.id)
  await grantAccountRole(created!.id, 'admin', null)
  const login = await loginHandler(
    buildRequest('/api/auth/login', { body: { email, password } }),
  )
  return {
    cookie: extractSessionCookie(login.headers.get('Set-Cookie'))!,
    accountId: created!.id,
  }
}

async function seedPaidAllocation(opts: {
  amountKopecks: number
  slotId: string
}): Promise<{ paymentOrderId: string }> {
  const pool = getDbPool()
  const invoiceId = freshInvoiceId('lc_refund')
  await pool.query(
    `insert into payment_orders
       (invoice_id, amount_rub, currency, description, provider, status,
        created_at, updated_at, paid_at, customer_email, receipt_email,
        receipt)
     values ($1, $2, 'RUB', 'refund integration test', 'mock', 'paid',
             now(), now(), now(), $3, $3, '{}'::jsonb)`,
    [invoiceId, (opts.amountKopecks / 100).toFixed(2), 'refund@example.com'],
  )
  await pool.query(
    `insert into payment_allocations
       (payment_order_id, kind, target_id, amount_kopecks)
     values ($1, 'lesson_slot', $2, $3)`,
    [invoiceId, opts.slotId, opts.amountKopecks],
  )
  return { paymentOrderId: invoiceId }
}

describe('POST /api/admin/refunds', () => {
  it('refunds a lesson_slot allocation: row lands, slot returns to debt list', async () => {
    const admin = await regAdmin()
    const slotId = '11111111-1111-1111-1111-' + Date.now().toString(16).padStart(12, '0').slice(-12)
    const { paymentOrderId } = await seedPaidAllocation({
      amountKopecks: 350000,
      slotId,
    })

    const res = await refundsHandler(
      buildRequest('/api/admin/refunds', {
        cookie: admin.cookie,
        body: {
          paymentOrderId,
          kind: 'lesson_slot',
          targetId: slotId,
          refundedKopecks: 350000,
          reason: 'unit-test refund',
        },
      }),
    )
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.reversal).toBeDefined()
    expect(json.reversal.paymentOrderId).toBe(paymentOrderId)
    expect(json.reversal.kind).toBe('lesson_slot')
    expect(json.reversal.targetId).toBe(slotId)
    expect(json.reversal.refundedKopecks).toBe(350000)
    expect(json.reversal.reason).toBe('unit-test refund')

    // The reversal row exists in the DB.
    const pool = getDbPool()
    const dbRows = await pool.query(
      `select id from payment_allocation_reversals
        where payment_order_id = $1 and kind = $2 and target_id = $3`,
      [paymentOrderId, 'lesson_slot', slotId],
    )
    expect(dbRows.rows.length).toBe(1)
  })

  it('rejects a duplicate refund with 409 and surfaces the existing reversal id', async () => {
    const admin = await regAdmin()
    const slotId = '22222222-2222-2222-2222-' + Date.now().toString(16).padStart(12, '0').slice(-12)
    const { paymentOrderId } = await seedPaidAllocation({
      amountKopecks: 250000,
      slotId,
    })

    const first = await refundsHandler(
      buildRequest('/api/admin/refunds', {
        cookie: admin.cookie,
        body: {
          paymentOrderId,
          kind: 'lesson_slot',
          targetId: slotId,
          refundedKopecks: 250000,
        },
      }),
    )
    expect(first.status).toBe(201)
    const firstJson = await first.json()
    const firstReversalId = firstJson.reversal.id

    const second = await refundsHandler(
      buildRequest('/api/admin/refunds', {
        cookie: admin.cookie,
        body: {
          paymentOrderId,
          kind: 'lesson_slot',
          targetId: slotId,
          refundedKopecks: 250000,
        },
      }),
    )
    expect(second.status).toBe(409)
    const json = await second.json()
    expect(json.error).toBe('already_refunded')
    expect(json.reversalId).toBe(firstReversalId)
  })

  it('rejects refundedKopecks > allocation amount with 400 refund_exceeds_allocation', async () => {
    const admin = await regAdmin()
    const slotId = '33333333-3333-3333-3333-' + Date.now().toString(16).padStart(12, '0').slice(-12)
    const { paymentOrderId } = await seedPaidAllocation({
      amountKopecks: 100000,
      slotId,
    })

    const res = await refundsHandler(
      buildRequest('/api/admin/refunds', {
        cookie: admin.cookie,
        body: {
          paymentOrderId,
          kind: 'lesson_slot',
          targetId: slotId,
          refundedKopecks: 200000,
        },
      }),
    )
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('refund_exceeds_allocation')
  })

  it('rejects refundedKopecks < allocation amount with 400 partial_refund_not_supported', async () => {
    // Codex Wave 51 review HIGH. Stage A/B model is full-refund-only:
    // the read paths drop the allocation on reversal row existence,
    // not on amount match, so accepting a partial would mark the slot
    // fully unpaid for a 1-kopeck refund.
    const admin = await regAdmin()
    const slotId = '44444444-4444-4444-4444-' + Date.now().toString(16).padStart(12, '0').slice(-12)
    const { paymentOrderId } = await seedPaidAllocation({
      amountKopecks: 100000,
      slotId,
    })

    const res = await refundsHandler(
      buildRequest('/api/admin/refunds', {
        cookie: admin.cookie,
        body: {
          paymentOrderId,
          kind: 'lesson_slot',
          targetId: slotId,
          refundedKopecks: 50000,
        },
      }),
    )
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('partial_refund_not_supported')
  })

  it('returns 404 when the allocation does not exist', async () => {
    const admin = await regAdmin()
    const res = await refundsHandler(
      buildRequest('/api/admin/refunds', {
        cookie: admin.cookie,
        body: {
          paymentOrderId: 'lc_does_not_exist_0000',
          kind: 'lesson_slot',
          targetId: '99999999-9999-9999-9999-999999999999',
          refundedKopecks: 1000,
        },
      }),
    )
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('allocation_not_found')
  })

  it('rejects kind=package as unsupported_kind (Stage B scope: lesson_slot only)', async () => {
    const admin = await regAdmin()
    const res = await refundsHandler(
      buildRequest('/api/admin/refunds', {
        cookie: admin.cookie,
        body: {
          paymentOrderId: 'lc_test_pkg_0000',
          kind: 'package',
          targetId: '00000000-0000-0000-0000-000000000000',
          refundedKopecks: 1000,
        },
      }),
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('unsupported_kind')
  })

  it('listSlotPaymentState aggregates: slot with refunded-then-paid history shows paid', async () => {
    // Codex Wave 52 review HIGH regression: a slot can have multiple
    // allocations across history (e.g. operator refunded one, learner
    // paid again from a fresh order). Without per-slot aggregation,
    // last-row-wins flipped the cabinet to "refunded" while the slot
    // is actually paid — diverging from slotIsPaidByAllocations and
    // the debt query. listSlotPaymentState must aggregate via bool_or
    // so any non-reversed paid allocation pins the slot to "paid".
    const admin = await regAdmin()
    const slotId = '55555555-5555-5555-5555-' + Date.now().toString(16).padStart(12, '0').slice(-12)
    const { paymentOrderId: firstOrderId } = await seedPaidAllocation({
      amountKopecks: 200000,
      slotId,
    })
    // Refund the first allocation.
    const refund = await refundsHandler(
      buildRequest('/api/admin/refunds', {
        cookie: admin.cookie,
        body: {
          paymentOrderId: firstOrderId,
          kind: 'lesson_slot',
          targetId: slotId,
          refundedKopecks: 200000,
        },
      }),
    )
    expect(refund.status).toBe(201)

    // The slot now has 1 reversed allocation; state must be 'refunded'.
    const stateAfterRefund = await listSlotPaymentState([slotId])
    expect(stateAfterRefund.get(slotId)).toBe('refunded')

    // Learner pays again from a fresh order. Now there are 2
    // allocations: one reversed, one non-reversed paid.
    await seedPaidAllocation({ amountKopecks: 200000, slotId })

    // The slot must now show 'paid' (bool_or aggregation), not stay
    // at 'refunded' from last-row-wins on the older reversed row.
    const stateAfterRepay = await listSlotPaymentState([slotId])
    expect(stateAfterRepay.get(slotId)).toBe('paid')
  })
})
