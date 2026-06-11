import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { POST as adminCreateHandler } from '@/app/api/admin/slots/route'
import { POST as bookHandler } from '@/app/api/slots/[id]/book/route'
import { POST as loginHandler } from '@/app/api/auth/login/route'
import { POST as registerHandler } from '@/app/api/auth/register/route'
import {
  getAccountByEmail,
  grantAccountRole,
  markAccountVerified,
  setAssignedTeacher,
} from '@/lib/auth/accounts'
import { getPaymentMethodForPair } from '@/lib/billing/learner-payment-method'
import { getDbPool } from '@/lib/db/pool'

import '../setup'
import {
  buildRequest,
  extractSessionCookie,
  futureSlotIso,
} from '../helpers'

// Bug #1 (2026-06-02) — cabinet missing-payment-method banner.
//
// Two halves:
//   - Predicate side (Scenarios A/B/C) — pins
//     getPaymentMethodForPair() return for the three states that drive
//     the banner. The cabinet renderer maps `=== 'none'` →
//     paymentMethodNotSet. This is the SoT for the UI gate.
//   - Route side (Scenario D) — confirms the booking handler maps
//     reason='payment_method_not_set' to 422 with the verbatim message
//     so stale-tab / deep-link learners stop seeing the misleading
//     generic 409 «Это время только что забронировал кто-то другой».
//
// Plan: docs/plans/bug-1-payment-method-banner.md §Tests Test 3.

beforeAll(() => {
  process.env.BILLING_WAVE_ACTIVE = 'true'
})

afterAll(() => {
  delete process.env.BILLING_WAVE_ACTIVE
})

async function reg(
  email: string,
  opts: { role?: 'admin' | 'teacher' | 'student'; verifyEmail?: boolean } = {},
) {
  const password = 'StrongPassword123'
  await registerHandler(
    buildRequest('/api/auth/register', {
      body: { email, password, personalDataConsentAccepted: true },
    }),
  )
  const created = await getAccountByEmail(email)
  if (opts.verifyEmail !== false) await markAccountVerified(created!.id)
  if (opts.role) await grantAccountRole(created!.id, opts.role, null)
  const login = await loginHandler(
    buildRequest('/api/auth/login', { body: { email, password } }),
  )
  return {
    cookie: extractSessionCookie(login.headers.get('Set-Cookie'))!,
    accountId: created!.id,
  }
}

async function setupPair(prefix: string) {
  const admin = await reg(`${prefix}-admin@example.com`, { role: 'admin' })
  const teacher = await reg(`${prefix}-teacher@example.com`, { role: 'teacher' })
  const learner = await reg(`${prefix}-learner@example.com`)
  await setAssignedTeacher(learner.accountId, teacher.accountId)
  return { admin, teacher, learner }
}

async function setPairPaymentMethod(
  teacherId: string,
  learnerId: string,
  method: 'postpaid' | 'none',
) {
  await getDbPool().query(
    `insert into learner_billing_preferences
       (teacher_account_id, learner_account_id, payment_method)
     values ($1::uuid, $2::uuid, $3)
     on conflict (teacher_account_id, learner_account_id) do update
       set payment_method = excluded.payment_method`,
    [teacherId, learnerId, method],
  )
}

async function makeOpenSlot(
  adminCookie: string,
  teacherAccountId: string,
  startAt: string,
  durationMinutes = 60,
): Promise<string> {
  const r = await adminCreateHandler(
    buildRequest('/api/admin/slots', {
      cookie: adminCookie,
      body: { teacherAccountId, startAt, durationMinutes, tariffId: null },
    }),
  )
  expect(r.status).toBe(201)
  return (await r.json()).slot.id as string
}

describe('Bug #1 — getPaymentMethodForPair predicate (banner SoT)', () => {
  it('A: returns "none" when no learner_billing_preferences row exists', async () => {
    const { teacher, learner } = await setupPair('bug1-pred-a')
    // No UPSERT — row absent.
    const method = await getPaymentMethodForPair(
      teacher.accountId,
      learner.accountId,
    )
    expect(method).toBe('none')
  })

  it('B: returns "none" when row exists with payment_method=\'none\'', async () => {
    const { teacher, learner } = await setupPair('bug1-pred-b')
    await setPairPaymentMethod(teacher.accountId, learner.accountId, 'none')
    const method = await getPaymentMethodForPair(
      teacher.accountId,
      learner.accountId,
    )
    expect(method).toBe('none')
  })

  it('C: returns "postpaid" when row exists with payment_method=\'postpaid\' (banner should NOT render)', async () => {
    const { teacher, learner } = await setupPair('bug1-pred-c')
    await setPairPaymentMethod(teacher.accountId, learner.accountId, 'postpaid')
    const method = await getPaymentMethodForPair(
      teacher.accountId,
      learner.accountId,
    )
    expect(method).toBe('postpaid')
  })
})

describe('Bug #1 — booking route maps payment_method_not_set → 422', () => {
  it('D: POST /api/slots/[id]/book returns 422 with verbatim banner copy', async () => {
    const { admin, teacher, learner } = await setupPair('bug1-route-d')
    // payment_method='none' (default — no UPSERT needed, but pin
    // explicitly so the test is robust to default flips).
    await setPairPaymentMethod(teacher.accountId, learner.accountId, 'none')

    const slotId = await makeOpenSlot(
      admin.cookie,
      teacher.accountId,
      futureSlotIso(60 * 24 * 3),
      60,
    )
    const r = await bookHandler(
      buildRequest(`/api/slots/${slotId}/book`, {
        cookie: learner.cookie,
        body: {},
      }),
      { params: Promise.resolve({ id: slotId }) },
    )
    expect(r.status).toBe(422)
    const body = (await r.json()) as { error?: string; message?: string }
    expect(body.error).toBe('payment_method_not_set')
    expect(body.message).toContain(
      'Учитель должен выбрать модель оплаты за занятия',
    )
    // Style-guide pin: never «слот» in the user-facing message
    // (docs/content-style.md:116).
    expect(body.message ?? '').not.toMatch(/слот/i)
  })
})
