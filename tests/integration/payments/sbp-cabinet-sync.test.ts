// Cabinet ↔ payment_claim integration: ensures the helper that gates the
// learner cabinet «Оплатить» button knows about an SBP-claim once the
// teacher mark-paids the slot. Before this contract existed, a learner
// could press «Оплатить» on an already-acknowledged slot and the modal
// blew up with /api/learner/payment-context 404 already_paid.

import { beforeEach, describe, expect, it } from 'vitest'

import { getAuthPool } from '@/lib/auth/pool'
import {
  createTeacherMarkPaid,
  listClaimedOrConfirmedSlotIds,
} from '@/lib/payments/sbp-claims'
import {
  createRefund,
  listRefundsForLearner,
} from '@/lib/payments/sbp-refunds'

import '../setup'

type Pair = { teacherId: string; learnerId: string; slotId: string }

async function seedTeacherLearnerSlot(): Promise<Pair> {
  const pool = getAuthPool()
  const t = await pool.query<{ id: string }>(
    `insert into accounts (email, password_hash, email_verified_at, created_at, updated_at)
     values ('teacher-' || gen_random_uuid() || '@test', 'x', now(), now(), now())
     returning id`,
  )
  const teacherId = t.rows[0].id
  await pool.query(
    `insert into account_roles (account_id, role) values ($1, 'teacher')`,
    [teacherId],
  )
  const l = await pool.query<{ id: string }>(
    `insert into accounts (email, password_hash, email_verified_at, created_at, updated_at)
     values ('learner-' || gen_random_uuid() || '@test', 'x', now(), now(), now())
     returning id`,
  )
  const learnerId = l.rows[0].id
  await pool.query(
    `insert into account_roles (account_id, role) values ($1, 'student')`,
    [learnerId],
  )
  await pool.query(
    `insert into learner_teacher_links (learner_account_id, teacher_account_id)
     values ($1, $2)`,
    [learnerId, teacherId],
  )
  // Slot must respect the 30-min MSK grid (mig 0031). Pick a far-future
  // top-of-hour MSK timestamp.
  const futureMsk = new Date(Date.now() + 7 * 86_400_000)
  futureMsk.setUTCMinutes(0, 0, 0)
  const slot = await pool.query<{ id: string }>(
    `insert into lesson_slots
        (teacher_account_id, learner_account_id, start_at,
         duration_minutes, status, snapshot_amount_kopecks, booked_at)
     values ($1, $2, $3, 60, 'booked', 160000, now())
     returning id`,
    [teacherId, learnerId, futureMsk.toISOString()],
  )
  return { teacherId, learnerId, slotId: slot.rows[0].id }
}

let pair: Pair

beforeEach(async () => {
  // setup.ts truncates between tests, so re-seed every time.
  pair = await seedTeacherLearnerSlot()
})

describe('listClaimedOrConfirmedSlotIds (cabinet «Оплатить» gate)', () => {
  it('returns empty set when no claim covers the slot', async () => {
    const out = await listClaimedOrConfirmedSlotIds([pair.slotId])
    expect(out.has(pair.slotId)).toBe(false)
  })

  it('returns the slot once a teacher-initiated confirmed claim covers it', async () => {
    const r = await createTeacherMarkPaid({
      teacherAccountId: pair.teacherId,
      learnerAccountId: pair.learnerId,
      amountKopecks: 160_000,
      paymentChannel: 'sbp',
      items: [{ slotId: pair.slotId, expectedAmountKopecks: 160_000 }],
    })
    if (!r.ok) throw new Error(`mark-paid failed: ${r.reason}`)
    const out = await listClaimedOrConfirmedSlotIds([pair.slotId])
    expect(out.has(pair.slotId)).toBe(true)
  })

  it('ignores slot ids that are not in the input array (no over-fetch)', async () => {
    const out = await listClaimedOrConfirmedSlotIds([])
    expect(out.size).toBe(0)
  })
})

describe('listRefundsForLearner — учительский refund виден ученику', () => {
  it('mirrors teacher-side refund so the learner cabinet can render it', async () => {
    // beforeEach gives us a fresh teacher/learner/slot; create a
    // confirmed claim first, then refund a portion of it.
    const mark = await createTeacherMarkPaid({
      teacherAccountId: pair.teacherId,
      learnerAccountId: pair.learnerId,
      amountKopecks: 160_000,
      paymentChannel: 'sbp',
      items: [{ slotId: pair.slotId, expectedAmountKopecks: 160_000 }],
    })
    if (!mark.ok) throw new Error(`mark-paid failed: ${mark.reason}`)

    const pool = getAuthPool()
    const claim = await pool.query<{ id: string; amount_kopecks: number }>(
      `select id, amount_kopecks from payment_claims
        where teacher_account_id = $1
          and learner_account_id = $2
        order by claimed_at desc
        limit 1`,
      [pair.teacherId, pair.learnerId],
    )
    expect(claim.rows.length).toBe(1)

    const refundCreate = await createRefund(
      pair.teacherId,
      claim.rows[0].id,
      Math.min(50_000, claim.rows[0].amount_kopecks),
      'slot_cancelled',
      'тест возврата',
    )
    expect(refundCreate.ok).toBe(true)

    const refunds = await listRefundsForLearner(pair.learnerId, 50)
    expect(refunds.length).toBeGreaterThanOrEqual(1)
    const r = refunds.find((x) => x.claimId === claim.rows[0].id)
    expect(r).toBeDefined()
    expect(r!.amountKopecks).toBe(50_000)
    expect(r!.reason).toBe('slot_cancelled')
    expect(r!.note).toBe('тест возврата')
  })

  it('returns empty list when the learner has no claims', async () => {
    const pool = getAuthPool()
    const stranger = await pool.query<{ id: string }>(
      `insert into accounts (email, password_hash, email_verified_at, created_at, updated_at)
       values ('stranger-' || gen_random_uuid() || '@test', 'x', now(), now(), now())
       returning id`,
    )
    const out = await listRefundsForLearner(stranger.rows[0].id)
    expect(out).toEqual([])
  })
})
