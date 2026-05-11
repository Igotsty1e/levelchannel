// Wave 39: lifecycle mutations extracted from slots.ts.
// markSlotLifecycle + autoCompletePastBookedSlots. No billing.

import { getDbPool } from '@/lib/db/pool'

import {
  SLOT_COLUMNS,
  UUID_PATTERN,
  appendEventSql,
  rowToSlot,
} from './internal'
import type { LessonSlot, SlotLifecycleStatus } from './types'

// Phase 5: operator stamps a lifecycle status on a booked slot whose
// start has already passed. Refuses if the row is not booked or if
// start_at is still in the future.
export async function markSlotLifecycle(
  slotId: string,
  status: SlotLifecycleStatus,
  actorAccountId: string,
): Promise<{ ok: true; slot: LessonSlot } | { ok: false; reason: 'not_found' | 'not_booked' | 'not_yet_started' }> {
  if (!UUID_PATTERN.test(slotId)) return { ok: false, reason: 'not_found' }
  const pool = getDbPool()
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
  // Distinguish reasons for friendly errors.
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

// Phase 5: auto-complete cron — flip every still-`booked` row whose
// `start_at + duration_minutes` has elapsed to `completed`. Operator
// overrides set status away from `booked` first, so they're naturally
// skipped by the WHERE clause.
export async function autoCompletePastBookedSlots(): Promise<{
  completed: number
}> {
  const pool = getDbPool()
  const event = JSON.stringify([
    {
      type: 'slot.completed',
      at: new Date().toISOString(),
      actor: 'system',
      payload: { source: 'auto-complete' },
    },
  ])
  const result = await pool.query(
    `update lesson_slots
        set status = 'completed',
            marked_at = now(),
            updated_at = now(),
            events = $1::jsonb || events
      where status = 'booked'
        and start_at + (duration_minutes || ' minutes')::interval <= now()`,
    [event],
  )
  return { completed: result.rowCount ?? 0 }
}
