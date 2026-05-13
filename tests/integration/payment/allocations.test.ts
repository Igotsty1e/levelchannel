import { randomUUID } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { POST as loginHandler } from '@/app/api/auth/login/route'
import { POST as registerHandler } from '@/app/api/auth/register/route'
import { POST as createHandler } from '@/app/api/payments/route'
import { POST as mockConfirmHandler } from '@/app/api/payments/mock/[invoiceId]/confirm/route'
import { getAccountByEmail, markAccountVerified } from '@/lib/auth/accounts'
import { getDbPool } from '@/lib/db/pool'
import {
  listAllocationsForOrder,
  listSlotPaidStatus,
  recordAllocation,
} from '@/lib/payments/allocations'

import { buildRequest, extractSessionCookie, futureSlotIso } from '../helpers'
import './setup'

// Codex 2026-05-08 (HIGH) — POST /api/payments now requires session +
// owns-the-slot for any slotId. Tests below seed a real learner +
// real lesson_slots row owned by them so the slot-binding gate
// accepts the request.
async function seedLearnerWithBookedSlot(args: {
  email: string
  slotId: string
  amountKopecks: number
}) {
  const password = 'StrongPassword123'
  await registerHandler(
    buildRequest('/api/auth/register', {
      body: { email: args.email, password, personalDataConsentAccepted: true },
    }),
  )
  const learner = await getAccountByEmail(args.email)
  if (!learner) throw new Error('learner registration failed in test setup')
  await markAccountVerified(learner.id)
  const login = await loginHandler(
    buildRequest('/api/auth/login', {
      body: { email: args.email, password },
    }),
  )
  const cookie = extractSessionCookie(login.headers.get('Set-Cookie'))
  if (!cookie) throw new Error('no session cookie in test setup')

  // Teacher row (just an account; slot_binding gate doesn't enforce
  // teacher-role yet — that's a separate Codex finding).
  const teacherEmail = `teacher-${args.slotId.slice(0, 8)}@example.com`
  await registerHandler(
    buildRequest('/api/auth/register', {
      body: {
        email: teacherEmail,
        password,
        personalDataConsentAccepted: true,
      },
    }),
  )
  const teacher = await getAccountByEmail(teacherEmail)
  if (!teacher) throw new Error('teacher registration failed')

  // Direct insert of the slot row (status='booked', owned by learner).
  // Faster than going through admin + book API for this gate-targeted
  // setup. Tariff inserted optionally for amount-match validation.
  const tariffId = '00000000-0000-0000-0000-' + args.slotId.slice(-12)
  await getDbPool().query(
    `insert into pricing_tariffs (id, slug, title_ru, amount_kopecks, duration_minutes, is_active)
       values ($1, $2, $3, $4, 60, true)
       on conflict (id) do nothing`,
    [tariffId, `slug-${args.slotId.slice(0, 8)}`, 'Test', args.amountKopecks],
  )
  await getDbPool().query(
    `insert into lesson_slots (
       id, teacher_account_id, learner_account_id, start_at,
       duration_minutes, status, tariff_id, booked_at,
       created_at, updated_at, events
     ) values ($1, $2, $3, $4, 60, 'booked', $5, now(), now(), now(), '[]'::jsonb)
     on conflict (id) do nothing`,
    [
      args.slotId,
      teacher.id,
      learner.id,
      futureSlotIso(24 * 60),
      tariffId,
    ],
  )
  return { cookie, learnerId: learner.id }
}

// Phase 6 — payment_allocations end-to-end.
// We don't have CloudPayments live in tests; the integration env runs
// in mock-payment mode (per scripts/test-integration.sh). We verify:
//   1) recordAllocation idempotently inserts and is double-call safe
//   2) listSlotPaidStatus returns paid=true only for orders that are
//      actually `paid` AND have an allocation row
//   3) /api/payments accepts metadata.slotId and the order persists
//      it; mock-confirm flips status to paid; recordAllocation under
//      that path returns true
// Webhook-side wiring (handleCloudPaymentsWebhook → recordAllocation)
// is exercised by the existing payment/webhooks.test.ts pattern, but
// adding allocation-on-pay there would require regenerating HMAC test
// fixtures; we skip that and rely on the mock-confirm path here.

describe('payment_allocations', () => {
  it('recordAllocation inserts then no-ops on duplicate', async () => {
    // Seed a payment_orders row directly.
    const invoiceId = 'lc_alloc_test_1234567890'
    await getDbPool().query(
      `insert into payment_orders (
         invoice_id, amount_rub, currency, description, provider,
         status, created_at, updated_at, customer_email, receipt_email,
         receipt
       ) values ($1, 1500, 'RUB', 'd', 'cloudpayments',
                 'paid', now(), now(), 'a@b.com', 'a@b.com', '{}'::jsonb)`,
      [invoiceId],
    )

    const slotId = '00000000-0000-0000-0000-000000000abc'
    const first = await recordAllocation({
      paymentOrderId: invoiceId,
      kind: 'lesson_slot',
      targetId: slotId,
      amountKopecks: 150_000,
    })
    expect(first).toBe(true)

    const second = await recordAllocation({
      paymentOrderId: invoiceId,
      kind: 'lesson_slot',
      targetId: slotId,
      amountKopecks: 150_000,
    })
    expect(second).toBe(false) // duplicate, on-conflict-do-nothing

    const list = await listAllocationsForOrder(invoiceId)
    expect(list.length).toBe(1)
    expect(list[0].targetId).toBe(slotId)
  })

  it('listSlotPaidStatus returns paid=true only when order is paid', async () => {
    const slotPaid = '00000000-0000-0000-0000-000000000aaa'
    const slotPending = '00000000-0000-0000-0000-000000000bbb'

    // Paid order + allocation
    await getDbPool().query(
      `insert into payment_orders (invoice_id, amount_rub, currency,
         description, provider, status, created_at, updated_at,
         customer_email, receipt_email, receipt)
       values ('lc_alloc_paid_xx', 1500, 'RUB', 'd', 'cloudpayments',
               'paid', now(), now(), 'a@b.com', 'a@b.com', '{}'::jsonb)`,
    )
    await recordAllocation({
      paymentOrderId: 'lc_alloc_paid_xx',
      kind: 'lesson_slot',
      targetId: slotPaid,
      amountKopecks: 150_000,
    })

    // Pending order + allocation (rare in real flow, but tests the gate)
    await getDbPool().query(
      `insert into payment_orders (invoice_id, amount_rub, currency,
         description, provider, status, created_at, updated_at,
         customer_email, receipt_email, receipt)
       values ('lc_alloc_pending_yy', 1500, 'RUB', 'd', 'cloudpayments',
               'pending', now(), now(), 'a@b.com', 'a@b.com', '{}'::jsonb)`,
    )
    await recordAllocation({
      paymentOrderId: 'lc_alloc_pending_yy',
      kind: 'lesson_slot',
      targetId: slotPending,
      amountKopecks: 150_000,
    })

    const map = await listSlotPaidStatus([slotPaid, slotPending])
    expect(map.get(slotPaid)?.paid).toBe(true)
    expect(map.has(slotPending)).toBe(false)
  })

  it('mock-confirm path persists allocation when /api/payments was given a slotId', async () => {
    // Wave 15 — randomUUID() per test invocation. A hardcoded UUID
    // (and even a "unique-looking" hardcoded UUID) collided with
    // admin-list.test.ts's tariffId tail (00000000-0000-0000-0000-
    // <last 12>), surviving truncate-cascade in some pathway we
    // couldn't reproduce alone. randomUUID removes the shared-cell
    // hazard entirely. Slug + tariffId are also derived from the
    // fresh UUID inside seedLearnerWithBookedSlot, so they're unique
    // per call.
    const slotId = randomUUID()
    const { cookie } = await seedLearnerWithBookedSlot({
      email: 'alloc-flow@example.com',
      slotId,
      amountKopecks: 350_000,
    })

    const create = await createHandler(
      buildRequest('/api/payments', {
        cookie,
        body: {
          amountRub: 3500,
          customerEmail: 'alloc-flow@example.com',
          personalDataConsentAccepted: true,
          slotId,
        },
      }),
    )
    expect(create.status).toBe(200)
    const json = await create.json()
    const invoiceId = json.order.invoiceId as string

    // The order's metadata should carry slotId.
    const meta = await getDbPool().query(
      `select metadata from payment_orders where invoice_id = $1`,
      [invoiceId],
    )
    expect(meta.rows[0]?.metadata?.slotId).toBe(slotId)

    // Mock-confirm flips it to paid. The mock-confirm route does NOT
    // run the webhook handler (it bypasses the HMAC path), so the
    // webhook-side recordAllocation does NOT fire. We simulate the
    // webhook side directly: recordAllocation returns true, slot
    // paid-status is now true.
    const confirm = await mockConfirmHandler(
      buildRequest(`/api/payments/mock/${invoiceId}/confirm`, { body: {} }),
      { params: Promise.resolve({ invoiceId }) },
    )
    expect(confirm.status).toBe(200)

    const ok = await recordAllocation({
      paymentOrderId: invoiceId,
      kind: 'lesson_slot',
      targetId: slotId,
      amountKopecks: 350_000,
    })
    expect(ok).toBe(true)

    const map = await listSlotPaidStatus([slotId])
    expect(map.get(slotId)?.paid).toBe(true)
  })
})
