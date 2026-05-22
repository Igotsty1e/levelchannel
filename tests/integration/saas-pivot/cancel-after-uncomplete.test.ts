import { describe, expect, it } from 'vitest'

import { getDbPool } from '@/lib/db/pool'
import {
  CancelAfterCompletionError,
  cancelSlot,
} from '@/lib/scheduling/slots'
import { markLessonCompleted } from '@/lib/teacher-ledger/mark-lesson-completed'

import { freshAccount, freshPastBookedSlot } from './_lesson-helpers'
import '../setup'

// SAAS-PIVOT Epic 5B Day 5B — cancel-after-uncomplete contract.
//
// Plan: docs/plans/saas-pivot-master.md §2.6 + §5 Day 5B.
//
// State machine being verified:
//   booked
//     ── markLessonCompleted ──▶ completed (or no_show_learner)
//        ── DELETE completion ──▶ booked    (reverse trigger)
//        ── cancelSlot ─────────▶ 409 CancelAfterCompletionError
//        ── stamp immutable_at ─▶ DELETE raises 40006 → un-mark fails
//        ── attach settlement ──▶ DELETE raises 40007 → un-mark fails
//
// Four spec'd scenarios:
//   1. Teacher marks slot completed → cancelSlot 409.
//   2. Teacher un-marks (DELETE completion) → status flips back to
//      booked → cancelSlot works.
//   3. 48h passes (immutable_at set) → DELETE blocked by trigger →
//      un-mark fails 409 → cancel impossible.
//   4. Settle covers completion → DELETE blocked → un-mark fails →
//      cancel impossible.
//
// The Day 5A spec covers items 1+2 partially (one test each). Here we
// double up with the full state-machine traversal so the 4-condition
// guard surface is end-to-end-verified.

async function markCompleted(
  slotId: string,
  teacherId: string,
): Promise<string> {
  const pool = getDbPool()
  const client = await pool.connect()
  try {
    await client.query('begin')
    const r = await markLessonCompleted(client, {
      slotId,
      teacherId,
      wasNoShow: false,
      markedByAccountId: teacherId,
    })
    await client.query('commit')
    return r.completionId
  } finally {
    client.release()
  }
}

describe('SAAS-PIVOT Day 5B — cancel-after-uncomplete state machine', () => {
  it('scenario 1: mark completed → cancelSlot rejects with CancelAfterCompletionError', async () => {
    const teacherId = await freshAccount('5b-cau-1-teacher')
    const learnerId = await freshAccount('5b-cau-1-learner')
    const slotId = await freshPastBookedSlot(teacherId, learnerId)
    await markCompleted(slotId, teacherId)

    await expect(
      cancelSlot(slotId, teacherId, 'cancel after mark', 'admin'),
    ).rejects.toThrow(CancelAfterCompletionError)
    // Status still completed — the cancel was rejected, no flip.
    const status = await getDbPool().query<{ status: string }>(
      `select status from lesson_slots where id = $1`,
      [slotId],
    )
    expect(status.rows[0].status).toBe('completed')
  })

  it('scenario 2: un-mark → status flips back to booked → cancelSlot succeeds', async () => {
    const teacherId = await freshAccount('5b-cau-2-teacher')
    const learnerId = await freshAccount('5b-cau-2-learner')
    const slotId = await freshPastBookedSlot(teacherId, learnerId)
    const completionId = await markCompleted(slotId, teacherId)

    const pool = getDbPool()
    // un-mark via direct DELETE (the API-route wraps this in a TX +
    // friendly-error gate; the trigger is what we're verifying here).
    await pool.query(`delete from lesson_completions where id = $1`, [
      completionId,
    ])
    const after = await pool.query<{ status: string }>(
      `select status from lesson_slots where id = $1`,
      [slotId],
    )
    expect(after.rows[0].status).toBe('booked')

    // cancel now works.
    const cancelled = await cancelSlot(
      slotId,
      teacherId,
      'cancel after un-mark',
      'admin',
    )
    expect(cancelled).not.toBeNull()
    expect(cancelled!.status).toBe('cancelled')
  })

  it('scenario 3: immutable_at set → DELETE blocked → cancel still rejected', async () => {
    const teacherId = await freshAccount('5b-cau-3-teacher')
    const learnerId = await freshAccount('5b-cau-3-learner')
    const slotId = await freshPastBookedSlot(teacherId, learnerId)
    const completionId = await markCompleted(slotId, teacherId)

    const pool = getDbPool()
    // Emulate the daily retention sweep stamping immutable_at after the
    // 48h window passes.
    await pool.query(
      `update lesson_completions set immutable_at = now() where id = $1`,
      [completionId],
    )

    // DELETE is blocked by the BEFORE DELETE 4-condition guard (40006).
    await expect(
      pool.query(`delete from lesson_completions where id = $1`, [completionId]),
    ).rejects.toThrow(/immutability passed/)

    // Status is still completed — the un-mark failed.
    const status = await pool.query<{ status: string }>(
      `select status from lesson_slots where id = $1`,
      [slotId],
    )
    expect(status.rows[0].status).toBe('completed')

    // Cancel remains rejected.
    await expect(
      cancelSlot(slotId, teacherId, 'try cancel post-immutable', 'admin'),
    ).rejects.toThrow(CancelAfterCompletionError)
  })

  it('scenario 4: settlement coverage → DELETE blocked → cancel still rejected', async () => {
    const teacherId = await freshAccount('5b-cau-4-teacher')
    const learnerId = await freshAccount('5b-cau-4-learner')
    const slotId = await freshPastBookedSlot(teacherId, learnerId, 200000)
    const completionId = await markCompleted(slotId, teacherId)

    const pool = getDbPool()
    // Attach a partial settlement to the completion.
    const settlement = await pool.query<{ id: string }>(
      `insert into lesson_settlements
         (learner_account_id, teacher_id, amount_kopecks)
       values ($1, $2, 100000)
       returning id`,
      [learnerId, teacherId],
    )
    await pool.query(
      `insert into lesson_settlement_completions
         (settlement_id, completion_id, amount_kopecks)
       values ($1, $2, 100000)`,
      [settlement.rows[0].id, completionId],
    )

    // DELETE blocked by 40007.
    await expect(
      pool.query(`delete from lesson_completions where id = $1`, [completionId]),
    ).rejects.toThrow(/settlement exists/)

    // Cancel still rejected.
    await expect(
      cancelSlot(slotId, teacherId, 'try cancel post-settle', 'admin'),
    ).rejects.toThrow(CancelAfterCompletionError)
  })
})
