// teacher-no-slots-mode (Задача 2.1, Sub-PR A, 2026-06-11).
//
// Per-teacher calendar slot-mode discriminator. Two values:
//   'open_slots'    — learners pick from teacher's open slots (default).
//   'direct_assign' — teacher assigns concrete time per learner; learner
//                     UI hides pickup section + create-slots buttons.
//
// Migration 0123 adds `accounts.calendar_slot_mode` column with default
// 'open_slots' and CHECK constraint. This module wraps read/write
// against that column.

import { getAuthPool } from '@/lib/auth/pool'

export type CalendarSlotMode = 'open_slots' | 'direct_assign'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const VALID_MODES: ReadonlySet<CalendarSlotMode> = new Set([
  'open_slots',
  'direct_assign',
])

export function isCalendarSlotMode(value: unknown): value is CalendarSlotMode {
  return typeof value === 'string' && VALID_MODES.has(value as CalendarSlotMode)
}

/**
 * Read the slot-mode for an account. Returns 'open_slots' for unknown
 * IDs (UX-safe default) or rows without the column (pre-mig-0123).
 */
export async function getCalendarSlotMode(
  accountId: string,
): Promise<CalendarSlotMode> {
  if (!UUID_PATTERN.test(accountId)) return 'open_slots'
  const pool = getAuthPool()
  const r = await pool.query<{ calendar_slot_mode: string | null }>(
    `select calendar_slot_mode from accounts where id = $1::uuid`,
    [accountId],
  )
  const v = r.rows[0]?.calendar_slot_mode
  return isCalendarSlotMode(v) ? v : 'open_slots'
}

/**
 * Set the slot-mode for an account. Returns the persisted value.
 * Callers SHOULD gate by teacher role and session ownership before
 * invoking; this writer trusts the input.
 */
export async function setCalendarSlotMode(
  accountId: string,
  mode: CalendarSlotMode,
): Promise<CalendarSlotMode> {
  if (!UUID_PATTERN.test(accountId)) {
    throw new Error('slot-mode/account_id_invalid')
  }
  if (!isCalendarSlotMode(mode)) {
    throw new Error('slot-mode/mode_invalid')
  }
  const pool = getAuthPool()
  await pool.query(
    `update accounts set calendar_slot_mode = $2, updated_at = now()
       where id = $1::uuid`,
    [accountId, mode],
  )
  return mode
}
