import { describe, expect, it } from 'vitest'

import { getAccountByEmail, markAccountVerified } from '@/lib/auth/accounts'
import { createPackage } from '@/lib/billing/packages'
import {
  listAccountActivePackages,
} from '@/lib/billing/packages/purchases'
import {
  learnerHasActivePackageOfDuration,
} from '@/lib/billing/packages/eligibility'
import { POST as registerHandler } from '@/app/api/auth/register/route'
import { getDbPool } from '@/lib/db/pool'

import '../setup'
import { buildRequest, freshInvoiceId } from '../helpers'

// PKG-LEARNER-BUY LBL.0 — eligibility predicate drift test.
//
// `learnerHasActivePackageOfDuration` must agree with
// `listAccountActivePackages` on every "is this purchase still
// active?" filter (voided_at IS NULL, expires_at > now(),
// count_remaining > 0). If a third reader is added later (e.g. a new
// cabinet card) and the helpers drift, this test fires.

async function makeLearner(emailPrefix: string): Promise<string> {
  const email = `${emailPrefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`
  await registerHandler(
    buildRequest('/api/auth/register', {
      body: { email, password: 'StrongPassword123', personalDataConsentAccepted: true },
    }),
  )
  const created = await getAccountByEmail(email)
  await markAccountVerified(created!.id)
  return created!.id
}

async function seedPurchase(opts: {
  accountId: string
  packageId: string
  amountKopecks: number
  titleSnapshot: string
  durationMinutes: number
  countInitial: number
  expiresIn: string
  voided?: boolean
}): Promise<string> {
  const seedInvoice = freshInvoiceId('lc_seed')
  await getDbPool().query(
    `insert into payment_orders (
       invoice_id, amount_rub, currency, description, provider, status,
       created_at, updated_at, paid_at, customer_email, receipt_email,
       receipt, metadata
     ) values (
       $1, 100, 'RUB', 'seed', 'mock', 'paid',
       now(), now(), now(), 'seed@example.com', 'seed@example.com',
       '{}'::jsonb, '{}'::jsonb
     )`,
    [seedInvoice],
  )
  const res = await getDbPool().query(
    `insert into package_purchases (
       account_id, package_id, payment_order_id, amount_kopecks,
       title_snapshot, duration_minutes, count_initial, expires_at, voided_at
     ) values ($1, $2, $3, $4, $5, $6, $7, now() + $8::interval, $9)
     returning id`,
    [
      opts.accountId,
      opts.packageId,
      seedInvoice,
      opts.amountKopecks,
      opts.titleSnapshot,
      opts.durationMinutes,
      opts.countInitial,
      opts.expiresIn,
      opts.voided ? new Date().toISOString() : null,
    ],
  )
  return res.rows[0].id
}

describe('learnerHasActivePackageOfDuration vs listAccountActivePackages', () => {
  it('agrees on the active-purchase set for a single learner', async () => {
    const accountId = await makeLearner('drift-single')
    const pkg60 = await createPackage({
      slug: `drift-60-${Date.now()}`,
      titleRu: '60 мин',
      durationMinutes: 60,
      count: 5,
      amountKopecks: 100_00,
    })
    const pkg90 = await createPackage({
      slug: `drift-90-${Date.now()}`,
      titleRu: '90 мин',
      durationMinutes: 90,
      count: 5,
      amountKopecks: 200_00,
    })
    await seedPurchase({
      accountId,
      packageId: pkg60.id,
      amountKopecks: pkg60.amountKopecks,
      titleSnapshot: pkg60.titleRu,
      durationMinutes: pkg60.durationMinutes,
      countInitial: pkg60.count,
      expiresIn: '30 days',
    })
    await seedPurchase({
      accountId,
      packageId: pkg90.id,
      amountKopecks: pkg90.amountKopecks,
      titleSnapshot: pkg90.titleRu,
      durationMinutes: pkg90.durationMinutes,
      countInitial: pkg90.count,
      expiresIn: '30 days',
    })
    const owned60 = await learnerHasActivePackageOfDuration(accountId, 60)
    const owned90 = await learnerHasActivePackageOfDuration(accountId, 90)
    const owned120 = await learnerHasActivePackageOfDuration(accountId, 120)
    expect(owned60).not.toBeNull()
    expect(owned90).not.toBeNull()
    expect(owned120).toBeNull()
    const active = await listAccountActivePackages(accountId)
    const activeDurations = active.map((p) => p.durationMinutes).sort()
    expect(activeDurations).toEqual([60, 90])
  })

  it('excludes voided purchases (both helpers agree)', async () => {
    const accountId = await makeLearner('drift-voided')
    const pkg = await createPackage({
      slug: `drift-voided-${Date.now()}`,
      titleRu: 'Voided',
      durationMinutes: 60,
      count: 5,
      amountKopecks: 100_00,
    })
    await seedPurchase({
      accountId,
      packageId: pkg.id,
      amountKopecks: pkg.amountKopecks,
      titleSnapshot: pkg.titleRu,
      durationMinutes: pkg.durationMinutes,
      countInitial: pkg.count,
      expiresIn: '30 days',
      voided: true,
    })
    const owned = await learnerHasActivePackageOfDuration(accountId, 60)
    expect(owned).toBeNull()
    const active = await listAccountActivePackages(accountId)
    expect(active).toEqual([])
  })

  it('excludes expired purchases (both helpers agree)', async () => {
    const accountId = await makeLearner('drift-expired')
    const pkg = await createPackage({
      slug: `drift-expired-${Date.now()}`,
      titleRu: 'Expired',
      durationMinutes: 60,
      count: 5,
      amountKopecks: 100_00,
    })
    await seedPurchase({
      accountId,
      packageId: pkg.id,
      amountKopecks: pkg.amountKopecks,
      titleSnapshot: pkg.titleRu,
      durationMinutes: pkg.durationMinutes,
      countInitial: pkg.count,
      expiresIn: '-1 day',
    })
    const owned = await learnerHasActivePackageOfDuration(accountId, 60)
    expect(owned).toBeNull()
    const active = await listAccountActivePackages(accountId)
    expect(active).toEqual([])
  })

  // Epic-end paranoia round 1 BLOCKER #1 regression. Earlier shape
  // `ORDER BY expires_at ASC LIMIT 1` + JS-side count_remaining filter
  // would mis-pick an EARLIER exhausted purchase ahead of a LATER
  // active one and return null. SQL now filters count_remaining > 0
  // directly. Seeding count_initial=0 hits a CHECK constraint, so we
  // simulate "exhausted" by inserting a package_consumption row
  // against a freshly-seeded slot. Requires a teacher account + a
  // valid future MSK-band slot.
  it('finds later active package when earlier same-duration purchase has count_remaining=0', async () => {
    const learner = await makeLearner('drift-mixed-learner')
    const teacher = await makeLearner('drift-mixed-teacher')
    const pkg = await createPackage({
      slug: `drift-mixed-${Date.now()}`,
      titleRu: 'Mixed',
      durationMinutes: 60,
      count: 1,
      amountKopecks: 100_00,
    })
    const exhaustedId = await seedPurchase({
      accountId: learner,
      packageId: pkg.id,
      amountKopecks: pkg.amountKopecks,
      titleSnapshot: 'Старый — 1 уже потрачен',
      durationMinutes: 60,
      countInitial: 1,
      expiresIn: '7 days',
    })
    const activeId = await seedPurchase({
      accountId: learner,
      packageId: pkg.id,
      amountKopecks: pkg.amountKopecks,
      titleSnapshot: 'Новый — 5 осталось',
      durationMinutes: 60,
      countInitial: 5,
      expiresIn: '60 days',
    })
    // Consume the one unit on the earlier purchase via a fresh slot.
    // 06:00 UTC = 09:00 MSK is in band; far future avoids any rule.
    const slotRow = await getDbPool().query(
      `insert into lesson_slots (id, teacher_account_id, start_at, duration_minutes, status)
       values (gen_random_uuid(), $1::uuid, '2027-01-15T06:00:00Z'::timestamptz, 60, 'open')
       returning id`,
      [teacher],
    )
    await getDbPool().query(
      `insert into package_consumptions (slot_id, package_purchase_id, consumed_by_actor)
       values ($1::uuid, $2::uuid, 'learner')`,
      [slotRow.rows[0].id, exhaustedId],
    )
    const owned = await learnerHasActivePackageOfDuration(learner, 60)
    expect(owned).not.toBeNull()
    expect(owned!.purchaseId).toBe(activeId)
    expect(owned!.countRemaining).toBe(5)
  })

  it('returns positive countRemaining for non-consumed purchases', async () => {
    const accountId = await makeLearner('drift-remaining')
    const pkg = await createPackage({
      slug: `drift-remaining-${Date.now()}`,
      titleRu: 'Remaining',
      durationMinutes: 60,
      count: 7,
      amountKopecks: 100_00,
    })
    await seedPurchase({
      accountId,
      packageId: pkg.id,
      amountKopecks: pkg.amountKopecks,
      titleSnapshot: pkg.titleRu,
      durationMinutes: pkg.durationMinutes,
      countInitial: pkg.count,
      expiresIn: '30 days',
    })
    const owned = await learnerHasActivePackageOfDuration(accountId, 60)
    expect(owned).not.toBeNull()
    expect(owned!.countRemaining).toBe(7)
    const active = await listAccountActivePackages(accountId)
    expect(active).toHaveLength(1)
    expect(active[0].countRemaining).toBe(7)
  })
})
