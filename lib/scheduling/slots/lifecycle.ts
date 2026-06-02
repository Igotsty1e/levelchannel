// Wave 39: lifecycle mutations extracted from slots.ts.
// SAAS-PIVOT Day 5A (2026-05-22): rewritten so the billable kinds
// ('completed' / 'no_show_learner') route through the unified
// `markLessonCompleted` helper. 'no_show_teacher' stays as a direct
// status write (not billable, no completion row). The daily auto-
// complete cron is DISABLED in the same deploy (per Owner Q-2 — manual
// only in MVP). See plan §2.6 + §5 Day 5A.

import { getDbPool } from '@/lib/db/pool'
import {
  LessonCompletionEligibilityError,
  markLessonCompleted,
} from '@/lib/teacher-ledger/mark-lesson-completed'

import {
  SLOT_COLUMNS,
  UUID_PATTERN,
  appendEventSql,
  rowToSlot,
} from './internal'
import type { LessonSlot, SlotLifecycleStatus } from './types'

// SAAS-PIVOT Day 5A — explicit dispatch on `status`:
//   - 'completed'        → markLessonCompleted({ wasNoShow: false })
//   - 'no_show_learner'  → markLessonCompleted({ wasNoShow: true })
//   - 'no_show_teacher'  → direct status write (not billable)
//
// The forward trigger derives lesson_slots.status from was_no_show
// inside the helper's TX. After Day 5A, no caller writes
// 'completed' / 'no_show_learner' to lesson_slots.status directly.
export async function markSlotLifecycle(
  slotId: string,
  status: SlotLifecycleStatus,
  actorAccountId: string,
): Promise<
  | { ok: true; slot: LessonSlot }
  | {
      ok: false
      reason:
        | 'not_found'
        | 'not_booked'
        | 'not_yet_started'
        | 'wrong_teacher'
        | 'missing_snapshot'
    }
> {
  if (!UUID_PATTERN.test(slotId)) return { ok: false, reason: 'not_found' }
  const pool = getDbPool()

  if (status === 'no_show_teacher') {
    // Non-billable path. Direct status write, same shape as before.
    const result = await pool.query(
      `update lesson_slots
          set status = $2,
              marked_at = coalesce(marked_at, now()),
              updated_at = now(),
              events = $3::jsonb || events
        where id = $1
          and status = 'booked'
          and start_at <= now()
        returning ${SLOT_COLUMNS}`,
      [
        slotId,
        status,
        appendEventSql('slot.lifecycle', 'admin', {
          toStatus: status,
          actorAccountId,
        }),
      ],
    )
    if (result.rows[0]) {
      return { ok: true, slot: rowToSlot(result.rows[0]) }
    }
    return await sniffMarkFailure(slotId)
  }

  // Billable path — route through markLessonCompleted.
  const wasNoShow = status === 'no_show_learner'
  const client = await pool.connect()
  try {
    await client.query('begin')
    // Need the slot's teacher_account_id to populate the helper's
    // anti-spoof teacherId param. We trust the SQL row, not the
    // caller — the helper itself re-checks under FOR UPDATE.
    const slotInfo = await client.query(
      `select teacher_account_id from lesson_slots where id = $1`,
      [slotId],
    )
    if (slotInfo.rows.length === 0) {
      await client.query('rollback')
      return { ok: false, reason: 'not_found' }
    }
    const teacherId = String(slotInfo.rows[0].teacher_account_id)
    try {
      await markLessonCompleted(client, {
        slotId,
        teacherId,
        wasNoShow,
        markedByAccountId: actorAccountId,
      })
    } catch (e) {
      await client.query('rollback')
      if (e instanceof LessonCompletionEligibilityError) {
        if (e.reason === 'slot_not_found') return { ok: false, reason: 'not_found' }
        if (e.reason === 'wrong_teacher') return { ok: false, reason: 'wrong_teacher' }
        if (e.reason === 'not_booked') return { ok: false, reason: 'not_booked' }
        if (e.reason === 'not_yet_ended') return { ok: false, reason: 'not_yet_started' }
        if (e.reason === 'missing_snapshot') {
          return { ok: false, reason: 'missing_snapshot' }
        }
      }
      throw e
    }
    // Stamp the marked_at + events log on the slot (the forward
    // trigger updates only status + updated_at). Keep parity with the
    // pre-Day-5A behaviour the admin UI depends on.
    const updated = await client.query(
      `update lesson_slots
          set marked_at = coalesce(marked_at, now()),
              events = $2::jsonb || events,
              updated_at = now()
        where id = $1
        returning ${SLOT_COLUMNS}`,
      [
        slotId,
        appendEventSql('slot.lifecycle', 'admin', {
          toStatus: status,
          actorAccountId,
        }),
      ],
    )
    await client.query('commit')
    if (updated.rows[0]) {
      return { ok: true, slot: rowToSlot(updated.rows[0]) }
    }
    return { ok: false, reason: 'not_found' }
  } catch (e) {
    await client.query('rollback').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}

async function sniffMarkFailure(slotId: string): Promise<
  | { ok: false; reason: 'not_found' | 'not_booked' | 'not_yet_started' }
> {
  const pool = getDbPool()
  const sniff = await pool.query(
    `select status, start_at from lesson_slots where id = $1`,
    [slotId],
  )
  if (sniff.rows.length === 0) return { ok: false, reason: 'not_found' }
  if (sniff.rows[0].status !== 'booked') {
    return { ok: false, reason: 'not_booked' }
  }
  return { ok: false, reason: 'not_yet_started' }
}

// SAAS-PIVOT Day 5A (2026-05-22): auto-complete is DISABLED per
// Owner Q-2 — manual marking only in MVP. The function stays exported
// so existing callers (legacy cron path) compile; it logs + returns
// zero. Future auto-mark configuration is a separate epic.
export async function autoCompletePastBookedSlots(): Promise<{
  completed: number
  disabled: true
}> {
  console.warn(
    JSON.stringify({
      level: 'warn',
      probe: 'autoCompletePastBookedSlots',
      msg: 'auto-complete cron disabled per Day-5A migration',
    }),
  )
  return { completed: 0, disabled: true }
}
