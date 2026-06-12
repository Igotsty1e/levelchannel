import { describe, expect, it } from 'vitest'

import { POST as loginHandler } from '@/app/api/auth/login/route'
import { POST as registerHandler } from '@/app/api/auth/register/route'
import {
  getAccountByEmail,
  grantAccountRole,
  markAccountVerified,
} from '@/lib/auth/accounts'
import { getDbPool } from '@/lib/db/pool'
import { assignSlotDirect } from '@/lib/scheduling/slots'

import '../setup'
import {
  buildRequest,
  extractSessionCookie,
  futureSlotIso,
} from '../helpers'

// teacher-direct-assign (Задача 2.2, 2026-06-11). Smoke coverage of the
// new verb: happy path (postpaid), guard rejections (learner not
// assigned, cross-teacher tariff, in-past), and concurrent-collision.

async function registerAndCookie(
  email: string,
  opts: { verifyEmail?: boolean; role?: 'admin' | 'teacher' } = {},
): Promise<{ cookie: string; accountId: string }> {
  const password = 'StrongPassword123'
  const reg = await registerHandler(
    buildRequest('/api/auth/register', {
      body: { email, password, personalDataConsentAccepted: true },
    }),
  )
  expect(reg.status).toBe(200)
  const created = await getAccountByEmail(email)
  expect(created).not.toBeNull()
  if (opts.verifyEmail) await markAccountVerified(created!.id)
  if (opts.role) await grantAccountRole(created!.id, opts.role, null)
  const login = await loginHandler(
    buildRequest('/api/auth/login', { body: { email, password } }),
  )
  expect(login.status).toBe(200)
  const cookie = extractSessionCookie(login.headers.get('Set-Cookie'))
  expect(cookie).not.toBeNull()
  return { cookie: cookie!, accountId: created!.id }
}

async function linkLearnerToTeacher(
  learnerId: string,
  teacherId: string,
): Promise<void> {
  await getDbPool().query(
    `insert into learner_teacher_links (learner_account_id, teacher_account_id, linked_at)
       values ($1, $2, now())
     on conflict (learner_account_id, teacher_account_id) do update
       set unlinked_at = null`,
    [learnerId, teacherId],
  )
}

async function seedTariff(
  teacherId: string,
  opts: { durationMinutes?: number; slug?: string; amountKopecks?: number } = {},
): Promise<string> {
  const durationMinutes = opts.durationMinutes ?? 60
  const slug = opts.slug ?? `slug-${Math.random().toString(36).slice(2, 10)}`
  const amount = opts.amountKopecks ?? 200000
  const r = await getDbPool().query<{ id: string }>(
    `insert into pricing_tariffs (slug, title_ru, amount_kopecks, duration_minutes, is_active, teacher_id)
       values ($1, 'Test', $2, $3, true, $4)
     returning id`,
    [slug, amount, durationMinutes, teacherId],
  )
  return r.rows[0].id
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

async function seedPackageForLearner(
  teacherId: string,
  learnerId: string,
  durationMinutes: number,
): Promise<string> {
  const pool = getDbPool()
  const pkg = await pool.query<{ id: string }>(
    `insert into lesson_packages
       (slug, title_ru, amount_kopecks, currency, duration_minutes,
        count, is_active, teacher_id)
       values ($1, 'Test pkg', 200000, 'RUB', $2, 5, true, $3::uuid)
     returning id`,
    [`pkg-${Math.random().toString(36).slice(2, 10)}`, durationMinutes, teacherId],
  )
  // Stub payment_order row for FK satisfaction (we don't go through
  // the buy flow). Uses the legacy column shape (`amount_rub`,
  // `invoice_id` PK as text).
  const invoiceId = `seed-pkg-${Math.random().toString(36).slice(2, 12)}`
  await pool.query(
    `insert into payment_orders
       (invoice_id, amount_rub, currency, description, provider, status,
        created_at, updated_at, paid_at, customer_email, receipt_email,
        receipt, metadata)
     values ($1, '2000.00', 'RUB', 'seed pkg', 'mock', 'paid',
             now(), now(), now(), 'seed@example.com', 'seed@example.com',
             '{}'::jsonb, jsonb_build_object('seed', true))`,
    [invoiceId],
  )
  const purchase = await pool.query<{ id: string }>(
    `insert into package_purchases
       (account_id, package_id, payment_order_id, amount_kopecks,
        currency, title_snapshot, duration_minutes, count_initial,
        expires_at, teacher_id)
       values ($1::uuid, $2::uuid, $3, 200000, 'RUB',
        'Test pkg', $4, 5, now() + interval '90 days', $5::uuid)
     returning id`,
    [
      learnerId,
      pkg.rows[0].id,
      invoiceId,
      durationMinutes,
      teacherId,
    ],
  )
  return purchase.rows[0].id
}

async function activateTeacherSubscription(teacherId: string) {
  await getDbPool().query(
    `insert into teacher_subscriptions (account_id, plan_slug, state)
     values ($1, 'operator-managed', 'active')
     on conflict (account_id) do update set plan_slug = excluded.plan_slug, state = excluded.state`,
    [teacherId],
  )
}

describe('assignSlotDirect — Задача 2.2 backend smoke', () => {
  it('happy path: postpaid → slot inserted in booked state with source=direct_assign', async () => {
    process.env.BILLING_WAVE_ACTIVE = 'true'

    const fp = Date.now().toString(36)
    const teacher = await registerAndCookie(`teacher-${fp}-a@example.com`, {
      verifyEmail: true,
      role: 'teacher',
    })
    const learner = await registerAndCookie(`learner-${fp}-a@example.com`, {
      verifyEmail: true,
    })
    await activateTeacherSubscription(teacher.accountId)
    await linkLearnerToTeacher(learner.accountId, teacher.accountId)
    await setPairPaymentMethod(teacher.accountId, learner.accountId, 'postpaid')

    const tariffId = await seedTariff(teacher.accountId, {
      durationMinutes: 60,
    })

    const startAt = futureSlotIso(24 * 60)
    const result = await assignSlotDirect({
      teacherAccountId: teacher.accountId,
      learnerAccountId: learner.accountId,
      startAt,
      durationMinutes: 60,
      tariffId,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.slot.status).toBe('booked')
    expect(result.slot.learnerAccountId).toBe(learner.accountId)
    expect(result.slot.teacherAccountId).toBe(teacher.accountId)
    expect(result.slot.tariffId).toBe(tariffId)
    expect(result.slot.source).toBe('direct_assign')
    expect(result.billing.kind).toBe('postpaid')

    // verify DB row
    const row = await getDbPool().query(
      `select status, source, learner_account_id, tariff_id
         from lesson_slots where id = $1`,
      [result.slot.id],
    )
    expect(row.rows[0].status).toBe('booked')
    expect(row.rows[0].source).toBe('direct_assign')
    expect(row.rows[0].learner_account_id).toBe(learner.accountId)
    expect(row.rows[0].tariff_id).toBe(tariffId)
  })

  it('rejects when learner has no active link to teacher', async () => {
    process.env.BILLING_WAVE_ACTIVE = 'true'
    const fp = Date.now().toString(36)
    const teacher = await registerAndCookie(`teacher-${fp}-b@example.com`, {
      verifyEmail: true,
      role: 'teacher',
    })
    const learner = await registerAndCookie(`learner-${fp}-b@example.com`, {
      verifyEmail: true,
    })
    await activateTeacherSubscription(teacher.accountId)
    // NB: no linkLearnerToTeacher
    const tariffId = await seedTariff(teacher.accountId)

    const r = await assignSlotDirect({
      teacherAccountId: teacher.accountId,
      learnerAccountId: learner.accountId,
      startAt: futureSlotIso(48 * 60),
      durationMinutes: 60,
      tariffId,
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe('learner_not_assigned')
  })

  it('rejects when tariff belongs to a different teacher', async () => {
    process.env.BILLING_WAVE_ACTIVE = 'true'
    const fp = Date.now().toString(36)
    const teacherA = await registerAndCookie(`teacher-${fp}-c1@example.com`, {
      verifyEmail: true,
      role: 'teacher',
    })
    const teacherB = await registerAndCookie(`teacher-${fp}-c2@example.com`, {
      verifyEmail: true,
      role: 'teacher',
    })
    const learner = await registerAndCookie(`learner-${fp}-c@example.com`, {
      verifyEmail: true,
    })
    await activateTeacherSubscription(teacherA.accountId)
    await activateTeacherSubscription(teacherB.accountId)
    await linkLearnerToTeacher(learner.accountId, teacherA.accountId)
    await setPairPaymentMethod(teacherA.accountId, learner.accountId, 'postpaid')

    // tariff owned by teacher B, but teacher A tries to use it
    const foreignTariffId = await seedTariff(teacherB.accountId)

    const r = await assignSlotDirect({
      teacherAccountId: teacherA.accountId,
      learnerAccountId: learner.accountId,
      startAt: futureSlotIso(72 * 60),
      durationMinutes: 60,
      tariffId: foreignTariffId,
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe('tariff_not_owned')
  })

  it('rejects in-past startAt', async () => {
    const fp = Date.now().toString(36)
    const teacher = await registerAndCookie(`teacher-${fp}-d@example.com`, {
      verifyEmail: true,
      role: 'teacher',
    })
    const learner = await registerAndCookie(`learner-${fp}-d@example.com`, {
      verifyEmail: true,
    })
    await activateTeacherSubscription(teacher.accountId)
    await linkLearnerToTeacher(learner.accountId, teacher.accountId)
    const tariffId = await seedTariff(teacher.accountId)

    const past = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    const r = await assignSlotDirect({
      teacherAccountId: teacher.accountId,
      learnerAccountId: learner.accountId,
      startAt: past,
      durationMinutes: 60,
      tariffId,
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe('in_past')
  })

  it('paymentMethod=none + matching package + auto → success via package (posthoc-audit 2026-06-12 contract align)', async () => {
    process.env.BILLING_WAVE_ACTIVE = 'true'
    const fp = Date.now().toString(36)
    const teacher = await registerAndCookie(`teacher-${fp}-f@example.com`, {
      verifyEmail: true,
      role: 'teacher',
    })
    const learner = await registerAndCookie(`learner-${fp}-f@example.com`, {
      verifyEmail: true,
    })
    await activateTeacherSubscription(teacher.accountId)
    await linkLearnerToTeacher(learner.accountId, teacher.accountId)
    // method intentionally 'none' — backend gate must NOT block when a
    // matching package exists.
    await setPairPaymentMethod(teacher.accountId, learner.accountId, 'none')

    const tariffId = await seedTariff(teacher.accountId, { durationMinutes: 60 })
    await seedPackageForLearner(teacher.accountId, learner.accountId, 60)

    const result = await assignSlotDirect({
      teacherAccountId: teacher.accountId,
      learnerAccountId: learner.accountId,
      startAt: futureSlotIso(48 * 60),
      durationMinutes: 60,
      tariffId,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.billing.kind).toBe('prepaid')
  })

  it('paymentMethod=none + matching package + billingChoice=postpaid → still 422 payment_method_not_set', async () => {
    process.env.BILLING_WAVE_ACTIVE = 'true'
    const fp = Date.now().toString(36)
    const teacher = await registerAndCookie(`teacher-${fp}-g@example.com`, {
      verifyEmail: true,
      role: 'teacher',
    })
    const learner = await registerAndCookie(`learner-${fp}-g@example.com`, {
      verifyEmail: true,
    })
    await activateTeacherSubscription(teacher.accountId)
    await linkLearnerToTeacher(learner.accountId, teacher.accountId)
    await setPairPaymentMethod(teacher.accountId, learner.accountId, 'none')
    const tariffId = await seedTariff(teacher.accountId, { durationMinutes: 60 })
    await seedPackageForLearner(teacher.accountId, learner.accountId, 60)

    const result = await assignSlotDirect({
      teacherAccountId: teacher.accountId,
      learnerAccountId: learner.accountId,
      startAt: futureSlotIso(72 * 60),
      durationMinutes: 60,
      tariffId,
      billingChoice: 'postpaid',
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('payment_method_not_set')
  })

  it('rejects second concurrent assign on same (teacher, start_at) with slot_collision', async () => {
    process.env.BILLING_WAVE_ACTIVE = 'true'
    const fp = Date.now().toString(36)
    const teacher = await registerAndCookie(`teacher-${fp}-e@example.com`, {
      verifyEmail: true,
      role: 'teacher',
    })
    const learner1 = await registerAndCookie(`learner-${fp}-e1@example.com`, {
      verifyEmail: true,
    })
    const learner2 = await registerAndCookie(`learner-${fp}-e2@example.com`, {
      verifyEmail: true,
    })
    await activateTeacherSubscription(teacher.accountId)
    await linkLearnerToTeacher(learner1.accountId, teacher.accountId)
    await linkLearnerToTeacher(learner2.accountId, teacher.accountId)
    await setPairPaymentMethod(teacher.accountId, learner1.accountId, 'postpaid')
    await setPairPaymentMethod(teacher.accountId, learner2.accountId, 'postpaid')

    const tariffId = await seedTariff(teacher.accountId)
    const startAt = futureSlotIso(96 * 60)

    const first = await assignSlotDirect({
      teacherAccountId: teacher.accountId,
      learnerAccountId: learner1.accountId,
      startAt,
      durationMinutes: 60,
      tariffId,
    })
    expect(first.ok).toBe(true)

    const second = await assignSlotDirect({
      teacherAccountId: teacher.accountId,
      learnerAccountId: learner2.accountId,
      startAt, // same time slot
      durationMinutes: 60,
      tariffId,
    })
    expect(second.ok).toBe(false)
    if (second.ok) return
    expect(second.reason).toBe('slot_collision')
  })
})
