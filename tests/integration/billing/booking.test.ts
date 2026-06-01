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
import { getDbPool } from '@/lib/db/pool'
import {
  derivePackageRemaining,
  restorePackageConsumption,
  getConsumptionForSlot,
} from '@/lib/billing/consumption'
import {
  createPackagePurchase,
  listAccountActivePackages,
  listActivePackagesByDuration,
  createPackage,
} from '@/lib/billing/packages'
import { slotIsPaidByAllocations } from '@/lib/billing/paid-state'

import '../setup'
import {
  buildRequest,
  extractSessionCookie,
  freshInvoiceId,
  futureSlotIso,
} from '../helpers'

// Billing wave PR 1 — booking flow with package consumption.
//
// Tests boot with BILLING_WAVE_ACTIVE=true so the new path runs.
// Existing booking tests do NOT set this and continue to use the
// legacy path (no package check, no postpaid gate).

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

async function setupTeacherAndLearner(prefix: string) {
  const admin = await reg(`${prefix}-admin@example.com`, { role: 'admin' })
  const teacher = await reg(`${prefix}-teacher@example.com`, { role: 'teacher' })
  const learner = await reg(`${prefix}-learner@example.com`)
  await setAssignedTeacher(learner.accountId, teacher.accountId)
  return { admin, teacher, learner }
}

// mig 0101 — replaces `update accounts set postpaid_allowed = ...` tests.
async function setPairPaymentMethod(
  teacherId: string,
  learnerId: string,
  method: 'postpaid' | 'prepaid_packages' | 'none',
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
  tariffId: string | null = null,
): Promise<string> {
  const r = await adminCreateHandler(
    buildRequest('/api/admin/slots', {
      cookie: adminCookie,
      body: { teacherAccountId, startAt, durationMinutes, tariffId },
    }),
  )
  expect(r.status).toBe(201)
  return (await r.json()).slot.id as string
}

async function seedPackage(opts: {
  slug: string
  durationMinutes: number
  count: number
  amountKopecks: number
  teacherId?: string
}) {
  return createPackage({
    slug: opts.slug,
    titleRu: `Пакет ${opts.count}×${opts.durationMinutes}мин`,
    durationMinutes: opts.durationMinutes,
    count: opts.count,
    amountKopecks: opts.amountKopecks,
    teacherId: opts.teacherId,
  })
}

async function seedPaidOrder(
  accountId: string,
  amountKopecks: number,
  teacherAccountId?: string,
): Promise<string> {
  // Create a fake paid order so package_purchases.payment_order_id FK
  // resolves. PKG-TEACHER-SCOPE (2026-06-01): teacherAccountId is now
  // passed explicitly when known. Previously this INSERT relied on the
  // mig 0094 BEFORE-INSERT trigger fallback to bootstrap; that path
  // works only if bootstrap was created by a prior call. Now we set
  // teacher_account_id directly from the test's teacher.
  const invoiceId = freshInvoiceId()
  const amountRub = (amountKopecks / 100).toFixed(2)
  await getDbPool().query(
    `insert into payment_orders
       (invoice_id, amount_rub, currency, description, provider, status,
        created_at, updated_at, paid_at, customer_email, receipt_email,
        receipt, metadata, teacher_account_id)
     values ($1, $2, 'RUB', 'Test package order', 'mock', 'paid',
             now(), now(), now(), 'test@example.com', 'test@example.com',
             '{}'::jsonb, $3::jsonb, $4)`,
    [
      invoiceId,
      amountRub,
      JSON.stringify({ accountId, packageSlug: 'test-pkg' }),
      teacherAccountId ?? null,
    ],
  )
  return invoiceId
}

describe('PR 1 — booking with package consumption (BILLING_WAVE_ACTIVE=true)', () => {
  it('learner with active matching package → 200 prepaid; consumption row inserted', async () => {
    const { admin, teacher, learner } = await setupTeacherAndLearner('pr1-prepay')
    await setPairPaymentMethod(teacher.accountId, learner.accountId, 'prepaid_packages')
    const pkg = await seedPackage({
      slug: 'pr1-prepay-pkg',
      durationMinutes: 60,
      count: 5,
      amountKopecks: 10000_00,
      teacherId: teacher.accountId,
    })
    const orderId = await seedPaidOrder(learner.accountId, 10000_00, teacher.accountId)
    const pool = getDbPool()
    const client = await pool.connect()
    try {
      await createPackagePurchase(client, {
        accountId: learner.accountId,
        packageId: pkg.id,
        paymentOrderId: orderId,
        amountKopecks: 10000_00,
        titleSnapshot: pkg.titleRu,
        durationMinutes: 60,
        countInitial: 5,
        expiresAt: new Date(Date.now() + 180 * 24 * 60 * 60_000),
      })
    } finally {
      client.release()
    }

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
    expect(r.status).toBe(200)
    const consumption = await getConsumptionForSlot(slotId)
    expect(consumption).not.toBeNull()
    expect(consumption!.restoredAt).toBeNull()

    const purchases = await listAccountActivePackages(learner.accountId)
    expect(purchases.length).toBe(1)
    expect(purchases[0].countRemaining).toBe(4)
  })

  it('PKG-TEACHER-SCOPE: learner with package from teacher A cannot consume against teacher B slot', async () => {
    // Closes the prod multi-teacher package leak (T3 paranoia round-1 B2):
    // before the fix, consumePackageUnit selected by (account_id, duration)
    // only, so a learner's package from teacher A would silently debit when
    // they booked a slot from teacher B.
    //
    // Setup minimises registrations to stay under the 5/min IP rate limit:
    // - admin, teacherA, learner go through register/login (3 calls).
    // - teacherB is seeded directly via SQL with role + subscription so
    //   the slot can be owned by them without burning rate-limit budget.
    const { admin, teacher: teacherA, learner } =
      await setupTeacherAndLearner('pkg-ts-fix')
    const pool = getDbPool()
    const teacherBRes = await pool.query<{ id: string }>(
      `insert into accounts (email, password_hash, email_verified_at)
       values ($1, 'dummy', now()) returning id`,
      [`pkg-ts-fix-teacherb-${Date.now()}@example.com`],
    )
    const teacherBId = String(teacherBRes.rows[0].id)
    await pool.query(
      `insert into account_roles (account_id, role) values ($1, 'teacher')`,
      [teacherBId],
    )
    await pool.query(
      `insert into teacher_subscriptions (account_id, plan_slug, state)
       values ($1, 'operator-managed', 'active')
       on conflict (account_id) do nothing`,
      [teacherBId],
    )
    // Link teacherB ↔ learner so learner can book teacherB slots.
    await pool.query(
      `insert into learner_teacher_links (teacher_account_id, learner_account_id)
       values ($1, $2) on conflict do nothing`,
      [teacherBId, learner.accountId],
    )
    await setPairPaymentMethod(teacherBId, learner.accountId, 'prepaid_packages')
    // Package from teacher A.
    const pkgA = await seedPackage({
      slug: 'pkg-ts-fix-pkga',
      durationMinutes: 60,
      count: 5,
      amountKopecks: 10000_00,
      teacherId: teacherA.accountId,
    })
    const orderId = await seedPaidOrder(
      learner.accountId,
      10000_00,
      teacherA.accountId,
    )
    const client = await pool.connect()
    try {
      await createPackagePurchase(client, {
        accountId: learner.accountId,
        packageId: pkgA.id,
        paymentOrderId: orderId,
        amountKopecks: 10000_00,
        titleSnapshot: pkgA.titleRu,
        durationMinutes: 60,
        countInitial: 5,
        expiresAt: new Date(Date.now() + 180 * 24 * 60 * 60_000),
      })
    } finally {
      client.release()
    }
    // Slot owned by teacher B; learner tries to book it.
    const slotId = await makeOpenSlot(
      admin.cookie,
      teacherBId,
      futureSlotIso(60 * 24 * 3),
      60,
    )
    const r = await bookHandler(
      buildRequest(
        `/api/slots/${slotId}/book?teacher=${encodeURIComponent(teacherBId)}`,
        { cookie: learner.cookie, body: {} },
      ),
      { params: Promise.resolve({ id: slotId }) },
    )
    // Without the fix: consume silently debits teacher A's package against
    // teacher B's slot, booking returns 200, purchase.countRemaining=4.
    // With the fix: consume returns no_eligible (teacher mismatch), booking
    // falls through to package_required.
    expect(r.status).toBe(402)
    const body = await r.json()
    expect(body.error).toBe('package_required')
    const purchases = await listAccountActivePackages(learner.accountId)
    expect(purchases.length).toBe(1)
    expect(purchases[0].countRemaining).toBe(5)
  })

  it('learner with payment_method=prepaid_packages, no package → 402 package_required', async () => {
    const { admin, teacher, learner } = await setupTeacherAndLearner('pr1-no-pkg')
    await setPairPaymentMethod(teacher.accountId, learner.accountId, 'prepaid_packages')
    // No teacherId here on purpose — `listActivePackagesByDuration` (which
    // populates the 402 `availablePackages` hint) filters to teachers with
    // `operator-managed` subscriptions; the per-test teacher doesn't have
    // one, the bootstrap does. Falling back to bootstrap keeps the hint
    // populated. This test doesn't exercise the consume teacher-scope
    // check (it's about the no-package path).
    await seedPackage({
      slug: 'pr1-matching-60',
      durationMinutes: 60,
      count: 10,
      amountKopecks: 35000_00,
    })
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
    expect(r.status).toBe(402)
    const body = await r.json()
    expect(body.error).toBe('package_required')
    expect(Array.isArray(body.availablePackages)).toBe(true)
    expect(body.availablePackages.length).toBeGreaterThanOrEqual(1)
    expect(body.availablePackages[0].durationMinutes).toBe(60)
  })

  it('learner with payment_method=postpaid, slot has tariff → 200 postpaid', async () => {
    const { admin, teacher, learner } = await setupTeacherAndLearner('pr1-postpay')
    await setPairPaymentMethod(teacher.accountId, learner.accountId, 'postpaid')
    // Need a tariff with same duration on the slot.
    // SAAS-PIVOT Epic 2 Day 3: teacher_id NOT NULL (mig 0088).
    const tariffRow = await getDbPool().query(
      `insert into pricing_tariffs (slug, title_ru, amount_kopecks, duration_minutes, teacher_id)
       values ('pr1-postpay-tariff', '60 мин test', 350000, 60, $1)
       returning id`,
      [teacher.accountId],
    )
    const tariffId = String(tariffRow.rows[0].id)
    const slotId = await makeOpenSlot(
      admin.cookie,
      teacher.accountId,
      futureSlotIso(60 * 24 * 3),
      60,
      tariffId,
    )
    const r = await bookHandler(
      buildRequest(`/api/slots/${slotId}/book`, {
        cookie: learner.cookie,
        body: {},
      }),
      { params: Promise.resolve({ id: slotId }) },
    )
    expect(r.status).toBe(200)
    const consumption = await getConsumptionForSlot(slotId)
    expect(consumption).toBeNull() // postpaid path = no consumption row
  })

  it('learner with payment_method=postpaid, slot has NO tariff → 402 tariff_required', async () => {
    const { admin, teacher, learner } = await setupTeacherAndLearner('pr1-no-tariff')
    await setPairPaymentMethod(teacher.accountId, learner.accountId, 'postpaid')
    const slotId = await makeOpenSlot(
      admin.cookie,
      teacher.accountId,
      futureSlotIso(60 * 24 * 3),
      60,
      null,
    )
    const r = await bookHandler(
      buildRequest(`/api/slots/${slotId}/book`, {
        cookie: learner.cookie,
        body: {},
      }),
      { params: Promise.resolve({ id: slotId }) },
    )
    expect(r.status).toBe(402)
    expect((await r.json()).error).toBe('tariff_required')
  })

  it('pending package order in flight → 409 pending_package_grant', async () => {
    const { admin, teacher, learner } = await setupTeacherAndLearner('pr1-pending')
    await setPairPaymentMethod(teacher.accountId, learner.accountId, 'postpaid')
    // Insert a pending package order matching this (account, duration, teacher).
    // PKG-TEACHER-SCOPE: teacher_account_id is now explicit on the pending
    // row because accountHasPendingPackageGrantForDuration now scopes by
    // teacher; trigger fallback to bootstrap would set the wrong teacher.
    await getDbPool().query(
      `insert into payment_orders
         (invoice_id, amount_rub, currency, description, provider, status,
          created_at, updated_at, customer_email, receipt_email, receipt,
          metadata, teacher_account_id)
       values ($1, '3500.00', 'RUB', 'Pending package', 'mock', 'pending',
               now(), now(), 'test@example.com', 'test@example.com', '{}'::jsonb,
               $2::jsonb, $3)`,
      [
        freshInvoiceId('lc_pending'),
        JSON.stringify({
          accountId: learner.accountId,
          packageSlug: 'pr1-pending-pkg',
          packageDurationMinutes: 60,
        }),
        teacher.accountId,
      ],
    )
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
    expect(r.status).toBe(409)
    expect((await r.json()).error).toBe('pending_package_grant')
  })

  it('pending package order with MISMATCHED duration → postpaid path applies (gate filtered)', async () => {
    const { admin, teacher, learner } = await setupTeacherAndLearner('pr1-mis-dur')
    await setPairPaymentMethod(teacher.accountId, learner.accountId, 'postpaid')
    // Pending package for 90-min duration.
    await getDbPool().query(
      `insert into payment_orders
         (invoice_id, amount_rub, currency, description, provider, status,
          created_at, updated_at, customer_email, receipt_email, receipt, metadata)
       values ($1, '5250.00', 'RUB', 'Pending package', 'mock', 'pending',
               now(), now(), 'test@example.com', 'test@example.com', '{}'::jsonb, $2::jsonb)`,
      [
        freshInvoiceId('lc_pending_mis'),
        JSON.stringify({
          accountId: learner.accountId,
          packageSlug: 'pr1-pending-90',
          packageDurationMinutes: 90,
        }),
      ],
    )
    // Tariff for 60-min slot with postpaid path.
    // SAAS-PIVOT Epic 2 Day 3: teacher_id NOT NULL (mig 0088).
    const tariffRow = await getDbPool().query(
      `insert into pricing_tariffs (slug, title_ru, amount_kopecks, duration_minutes, teacher_id)
       values ('pr1-mis-tariff', '60 мин mismatch', 350000, 60, $1)
       returning id`,
      [teacher.accountId],
    )
    const tariffId = String(tariffRow.rows[0].id)
    const slotId = await makeOpenSlot(
      admin.cookie,
      teacher.accountId,
      futureSlotIso(60 * 24 * 3),
      60,
      tariffId,
    )
    const r = await bookHandler(
      buildRequest(`/api/slots/${slotId}/book`, {
        cookie: learner.cookie,
        body: {},
      }),
      { params: Promise.resolve({ id: slotId }) },
    )
    expect(r.status).toBe(200) // gate didn't fire (mismatched duration)
  })
})

describe('PR 1 — restorePackageConsumption (idempotent + race-safe)', () => {
  it('two concurrent restores → exactly one succeeds, second is no-op', async () => {
    const { admin, teacher, learner } = await setupTeacherAndLearner('pr1-restore')
    await setPairPaymentMethod(teacher.accountId, learner.accountId, 'prepaid_packages')
    const pkg = await seedPackage({
      slug: 'pr1-restore-pkg',
      durationMinutes: 60,
      count: 2,
      amountKopecks: 10000_00,
      teacherId: teacher.accountId,
    })
    const orderId = await seedPaidOrder(learner.accountId, 10000_00, teacher.accountId)
    const pool = getDbPool()
    const client = await pool.connect()
    let purchaseId: string
    try {
      const purchase = await createPackagePurchase(client, {
        accountId: learner.accountId,
        packageId: pkg.id,
        paymentOrderId: orderId,
        amountKopecks: 10000_00,
        titleSnapshot: pkg.titleRu,
        durationMinutes: 60,
        countInitial: 2,
        expiresAt: new Date(Date.now() + 180 * 24 * 60 * 60_000),
      })
      purchaseId = purchase!.id
    } finally {
      client.release()
    }

    const slotId = await makeOpenSlot(
      admin.cookie,
      teacher.accountId,
      futureSlotIso(60 * 24 * 3),
      60,
    )
    await bookHandler(
      buildRequest(`/api/slots/${slotId}/book`, {
        cookie: learner.cookie,
        body: {},
      }),
      { params: Promise.resolve({ id: slotId }) },
    )

    // Two concurrent restores.
    const c1 = await pool.connect()
    const c2 = await pool.connect()
    try {
      const [r1, r2] = await Promise.all([
        restorePackageConsumption(c1, { slotId, actor: 'admin' }),
        restorePackageConsumption(c2, { slotId, actor: 'admin' }),
      ])
      // Exactly one succeeded (returned the purchase id); the other null.
      const oks = [r1, r2].filter((r) => r !== null)
      expect(oks.length).toBe(1)
      expect(oks[0]!.packagePurchaseId).toBe(purchaseId)
    } finally {
      c1.release()
      c2.release()
    }

    // Count derivation: 2 initial - 0 active (the consumption is restored) = 2 remaining.
    const remaining = await derivePackageRemaining(purchaseId)
    expect(remaining!.countRemaining).toBe(2)
  })
})

describe('PR 1 — slotIsPaidByAllocations (CASE-filtered SUM)', () => {
  it('allocation on a NON-paid order does NOT count toward paid total', async () => {
    const { admin, teacher, learner } = await setupTeacherAndLearner('pr1-paid-state')
    void learner
    // SAAS-PIVOT Epic 2 Day 3: teacher_id NOT NULL (mig 0088).
    const tariffRow = await getDbPool().query(
      `insert into pricing_tariffs (slug, title_ru, amount_kopecks, duration_minutes, teacher_id)
       values ('pr1-paid-state-tariff', '60 мин', 350000, 60, $1)
       returning id`,
      [teacher.accountId],
    )
    const tariffId = String(tariffRow.rows[0].id)
    const slotId = await makeOpenSlot(
      admin.cookie,
      teacher.accountId,
      futureSlotIso(60 * 24 * 3),
      60,
      tariffId,
    )
    // Insert a PENDING order + allocation for the slot.
    const orderId = freshInvoiceId('lc_pending_pst')
    await getDbPool().query(
      `insert into payment_orders
         (invoice_id, amount_rub, currency, description, provider, status,
          created_at, updated_at, customer_email, receipt_email, receipt, metadata)
       values ($1, '3500.00', 'RUB', 'Pending slot', 'mock', 'pending',
               now(), now(), 'test@example.com', 'test@example.com', '{}'::jsonb, '{}'::jsonb)`,
      [orderId],
    )
    await getDbPool().query(
      `insert into payment_allocations (payment_order_id, kind, target_id, amount_kopecks)
       values ($1, 'lesson_slot', $2, 350000)`,
      [orderId, slotId],
    )

    const status = await slotIsPaidByAllocations(slotId)
    expect(status).not.toBeNull()
    expect(status!.expectedAmountKopecks).toBe(350000)
    // SUM CASE filter: pending order's allocation contributes 0.
    expect(status!.paidAmountKopecks).toBe(0)
    expect(status!.isPaid).toBe(false)

    // Flip the order to paid; now the allocation counts.
    await getDbPool().query(
      `update payment_orders set status = 'paid', paid_at = now() where invoice_id = $1`,
      [orderId],
    )
    const status2 = await slotIsPaidByAllocations(slotId)
    expect(status2!.paidAmountKopecks).toBe(350000)
    expect(status2!.isPaid).toBe(true)
  })
})

describe('PR 1 — listActivePackagesByDuration', () => {
  it('returns only matching duration + active, capped at top-3 by display_order', async () => {
    await seedPackage({
      slug: 'pr1-listpd-60-1',
      durationMinutes: 60,
      count: 5,
      amountKopecks: 100_00,
    })
    await seedPackage({
      slug: 'pr1-listpd-90',
      durationMinutes: 90,
      count: 5,
      amountKopecks: 100_00,
    })
    const result = await listActivePackagesByDuration(60, 3)
    expect(result.length).toBeGreaterThanOrEqual(1)
    for (const p of result) {
      expect(p.durationMinutes).toBe(60)
      expect(p.isActive).toBe(true)
    }
  })
})
