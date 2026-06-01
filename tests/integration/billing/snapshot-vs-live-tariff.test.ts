import { describe, expect, it } from 'vitest'

import { listAccountPostpaidDebt } from '@/lib/billing/packages/debt'
import { slotIsPaidByAllocations } from '@/lib/billing/paid-state'
import { getDbPool } from '@/lib/db/pool'

import '../setup'

// T3 Sub-PR B R1-WARN#4 closure: prove that downstream readers prefer
// snapshot_amount_kopecks over live pricing_tariffs.amount_kopecks when
// the two differ. Models the production scenario where a teacher edits
// the tariff price AFTER booking — settlement / debt / payment binding
// must keep the original booking amount.

async function seedTeacherTariffSlotCompletion(args: {
  prefix: string
  snapshotKopecks: number
  liveTariffKopecks: number
}) {
  // Note: production has an `amount_kopecks immutable after first slot
  // reference` trigger on pricing_tariffs, so a teacher cannot in
  // practice change the price after a slot binds. The test fixtures
  // model the more abstract invariant ("reader prefers snapshot when
  // it differs from live tariff") by creating the tariff at the LIVE
  // price and seeding the slot with a DIFFERENT snapshot — modeling
  // the future state where a learner_tariff_access override frozen at
  // booking time legitimately diverges from the catalog price.
  const pool = getDbPool()
  const teacherRes = await pool.query<{ id: string }>(
    `insert into accounts (email, password_hash, email_verified_at)
     values ($1, 'dummy', now()) returning id`,
    [`${args.prefix}-t-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`],
  )
  const teacherId = String(teacherRes.rows[0].id)
  await pool.query(
    `insert into account_roles (account_id, role) values ($1, 'teacher')`,
    [teacherId],
  )
  const learnerRes = await pool.query<{ id: string }>(
    `insert into accounts (email, password_hash, email_verified_at)
     values ($1, 'dummy', now()) returning id`,
    [`${args.prefix}-l-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`],
  )
  const learnerId = String(learnerRes.rows[0].id)
  const tariffRes = await pool.query<{ id: string }>(
    `insert into pricing_tariffs (slug, title_ru, amount_kopecks, duration_minutes, teacher_id)
     values ($1, '60 мин', $2, 60, $3) returning id`,
    [
      `${args.prefix}-tariff-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      args.liveTariffKopecks,
      teacherId,
    ],
  )
  const tariffId = String(tariffRes.rows[0].id)
  const startAt = new Date()
  startAt.setUTCHours(10 - 3, 0, 0, 0)
  startAt.setUTCDate(startAt.getUTCDate() - 1)
  const slotRes = await pool.query<{ id: string }>(
    `insert into lesson_slots
       (teacher_account_id, start_at, duration_minutes, status, tariff_id,
        learner_account_id, booked_at, snapshot_amount_kopecks)
     values ($1, $2, 60, 'booked', $3, $4, now() - interval '1 day', $5)
     returning id`,
    [teacherId, startAt, tariffId, learnerId, args.snapshotKopecks],
  )
  const slotId = String(slotRes.rows[0].id)
  return { teacherId, learnerId, tariffId, slotId }
}

describe('T3 Sub-PR B: downstream readers prefer snapshot when live tariff diverged', () => {
  it('debt query returns snapshot, not edited tariff price', async () => {
    const { learnerId, slotId } = await seedTeacherTariffSlotCompletion({
      prefix: 'snap-debt',
      snapshotKopecks: 120000,
      liveTariffKopecks: 150000,
    })
    // Insert a lesson_completions row so debt query's INNER JOIN matches.
    await getDbPool().query(
      `insert into lesson_completions
         (slot_id, teacher_id, amount_kopecks, completed_at, marked_by_account_id)
       select $1, s.teacher_account_id, 150000, now(), s.teacher_account_id
         from lesson_slots s where s.id = $1`,
      [slotId],
    )
    const debt = await listAccountPostpaidDebt(learnerId)
    expect(debt).toHaveLength(1)
    // 120000 = booking snapshot. NOT 150000 = live tariff.
    expect(debt[0].expectedAmountKopecks).toBe(120000)
  })

  it('slot-binding amount-match uses snapshot, not edited tariff price', async () => {
    const { slotId } = await seedTeacherTariffSlotCompletion({
      prefix: 'snap-bind',
      snapshotKopecks: 120000,
      liveTariffKopecks: 150000,
    })
    // slotIsPaidByAllocations returns expected_amount based on snapshot.
    const verdict = await slotIsPaidByAllocations(slotId)
    expect(verdict).not.toBeNull()
    expect(verdict!.expectedAmountKopecks).toBe(120000)
  })
})
