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

  it('rejects a second full refund with 400 refund_exceeds_allocation (sum >> amount)', async () => {
    // Wave 54 — UNIQUE constraint dropped to support partials. A
    // second full-amount refund now fails by sum-exceeds-allocation,
    // not by unique-violation.
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
    expect(second.status).toBe(400)
    expect((await second.json()).error).toBe('refund_exceeds_allocation')
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

  it('accepts a partial refund: slot stays paid, second partial that hits sum>=amount flips to refunded', async () => {
    // Wave 54 — partial reversals supported. A partial keeps the slot
    // in the paid bucket (most of it was paid); a second partial whose
    // SUM reaches the allocation amount flips the slot to refunded.
    const admin = await regAdmin()
    const slotId = '44444444-4444-4444-4444-' + Date.now().toString(16).padStart(12, '0').slice(-12)
    const { paymentOrderId } = await seedPaidAllocation({
      amountKopecks: 100000,
      slotId,
    })

    // First partial: 30 of 100. Slot stays paid (state still 'paid').
    const first = await refundsHandler(
      buildRequest('/api/admin/refunds', {
        cookie: admin.cookie,
        body: {
          paymentOrderId,
          kind: 'lesson_slot',
          targetId: slotId,
          refundedKopecks: 30000,
        },
      }),
    )
    expect(first.status).toBe(201)
    const stateAfterFirst = await listSlotPaymentState([slotId])
    expect(stateAfterFirst.get(slotId)).toBe('paid')

    // Second partial: 70 of 100 → SUM = 100 = amount. Slot flips.
    const second = await refundsHandler(
      buildRequest('/api/admin/refunds', {
        cookie: admin.cookie,
        body: {
          paymentOrderId,
          kind: 'lesson_slot',
          targetId: slotId,
          refundedKopecks: 70000,
        },
      }),
    )
    expect(second.status).toBe(201)
    const stateAfterSecond = await listSlotPaymentState([slotId])
    expect(stateAfterSecond.get(slotId)).toBe('refunded')
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

  it('rejects unknown kind as unsupported_kind (kinds are lesson_slot | package)', async () => {
    const admin = await regAdmin()
    const res = await refundsHandler(
      buildRequest('/api/admin/refunds', {
        cookie: admin.cookie,
        body: {
          paymentOrderId: 'lc_test_bogus_0000',
          kind: 'subscription',
          targetId: '00000000-0000-0000-0000-000000000000',
          refundedKopecks: 1000,
        },
      }),
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('unsupported_kind')
  })

  it('refunds a kind=package allocation: voids the purchase + restores all active consumptions', async () => {
    // Wave 53 — kind='package' refund covers the package-purchase
    // case. Pre-seed: package, a purchase with N=2 active
    // consumptions on slots S1, S2. Then refund the package
    // allocation. Expect: voided_at non-null on purchase, both
    // consumptions show restored_at non-null, response carries
    // packageRestored.restoredConsumptions == 2.
    const admin = await regAdmin()
    const pool = getDbPool()

    // Seed package + 2 slots + 2 consumptions + allocation + paid order.
    const learnerEmail = `refund-pkg-${Date.now()}@example.com`
    const learner = await pool.query(
      `insert into accounts (email, password_hash, email_verified_at)
       values ($1, 'dummy', now()) returning id`,
      [learnerEmail],
    )
    const learnerId = String(learner.rows[0].id)

    const pkg = await pool.query(
      `insert into lesson_packages
         (slug, title_ru, duration_minutes, count, amount_kopecks, is_active)
       values ($1, '10x60 refund test', 60, 10, 350000, true)
       returning id`,
      [`refund-pkg-${Date.now()}`],
    )
    const pkgId = String(pkg.rows[0].id)

    const orderId = freshInvoiceId('lc_pkg_refund')
    await pool.query(
      `insert into payment_orders
         (invoice_id, amount_rub, currency, description, provider, status,
          created_at, updated_at, paid_at, customer_email, receipt_email,
          receipt, metadata)
       values ($1, '3500.00', 'RUB', 'pkg refund', 'mock', 'paid',
               now(), now(), now(), $2, $2, '{}'::jsonb,
               jsonb_build_object('accountId', $3::text, 'packageSlug', 'x',
                                   'packageDurationMinutes', 60, 'packageId', $4::text))`,
      [orderId, learnerEmail, learnerId, pkgId],
    )
    const purchase = await pool.query(
      `insert into package_purchases
         (account_id, package_id, payment_order_id, amount_kopecks, currency,
          title_snapshot, duration_minutes, count_initial, expires_at)
       values ($1, $2, $3, 350000, 'RUB', '10x60', 60, 10, now() + interval '180 days')
       returning id`,
      [learnerId, pkgId, orderId],
    )
    const purchaseId = String(purchase.rows[0].id)
    await pool.query(
      `insert into payment_allocations
         (payment_order_id, kind, target_id, amount_kopecks)
       values ($1, 'package', $2, 350000)`,
      [orderId, purchaseId],
    )

    // package_consumptions.slot_id FKs lesson_slots(id), so seed a
    // teacher + 2 booked slots first. Granting 'teacher' role is the
    // gate slotTeacherRole assert checks.
    const teacher = await pool.query(
      `insert into accounts (email, password_hash, email_verified_at)
       values ($1, 'dummy', now()) returning id`,
      [`refund-pkg-teacher-${Date.now()}@example.com`],
    )
    const teacherId = String(teacher.rows[0].id)
    await pool.query(
      `insert into account_roles (account_id, role)
       values ($1, 'teacher')`,
      [teacherId],
    )
    // start_at must be 30-min aligned in MSK + in business band 06-22.
    // Use date_trunc('hour') to land on HH:00:00 MSK (always valid).
    const slotInserts = await pool.query(
      `insert into lesson_slots
         (teacher_account_id, start_at, duration_minutes, status, learner_account_id, booked_at)
       values
         ($1, date_trunc('hour', (now() + interval '7 days') at time zone 'Europe/Moscow') at time zone 'Europe/Moscow', 60, 'booked', $2, now()),
         ($1, date_trunc('hour', (now() + interval '8 days') at time zone 'Europe/Moscow') at time zone 'Europe/Moscow', 60, 'booked', $2, now())
       returning id`,
      [teacherId, learnerId],
    )
    const slot1 = String(slotInserts.rows[0].id)
    const slot2 = String(slotInserts.rows[1].id)
    await pool.query(
      `insert into package_consumptions (slot_id, package_purchase_id, consumed_by_actor)
       values ($1, $3, 'learner'), ($2, $3, 'learner')`,
      [slot1, slot2, purchaseId],
    )

    const res = await refundsHandler(
      buildRequest('/api/admin/refunds', {
        cookie: admin.cookie,
        body: {
          paymentOrderId: orderId,
          kind: 'package',
          targetId: purchaseId,
          refundedKopecks: 350000,
          reason: 'package refund test',
        },
      }),
    )
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.reversal).toBeDefined()
    expect(json.packageRestored).toEqual({
      restoredConsumptions: 2,
      alreadyVoided: false,
    })

    // Purchase row marked voided.
    const purchaseAfter = await pool.query(
      `select voided_at from package_purchases where id = $1`,
      [purchaseId],
    )
    expect(purchaseAfter.rows[0].voided_at).not.toBeNull()

    // Both consumptions restored.
    const consumptionsAfter = await pool.query(
      `select count(*)::int as n
         from package_consumptions
        where package_purchase_id = $1 and restored_at is not null`,
      [purchaseId],
    )
    expect(consumptionsAfter.rows[0].n).toBe(2)
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
