// Wave 39: non-cancel write paths extracted from slots.ts.
// Contains all single-slot writers that do NOT touch billing:
// SlotTeacherRoleError class + assertTeacherRole helper, createSlot,
// bulkCreateSlots, editOpenSlot, moveOpenSlot, moveOpenSlotByTeacher,
// deleteOpenSlot.

import { listAccountRoles } from '@/lib/auth/accounts'
import { getDbPool } from '@/lib/db/pool'

import {
  SLOT_COLUMNS,
  UUID_PATTERN,
  appendEventSql,
  rowToSlot,
} from './internal'
import { validateSlotInput } from './validation'
import type {
  BulkCreateInput,
  BulkCreateResult,
  CreateSlotInput,
  DeleteOpenSlotResult,
  EditOpenSlotResult,
  LessonSlot,
  MoveOpenSlotResult,
  MoveTeacherSlotResult,
} from './types'

// Codex 2026-05-08 (MEDIUM-LOW) — slot creation must verify the
// `teacherAccountId` actually has the `teacher` role. Pre-fix, the
// admin route only shape-validated the UUID, so an admin could
// mistakenly create a slot pointing at a non-teacher account. The
// downstream booking flow (Codex #5, already closed) refuses
// self-bookings at the data layer, but a non-teacher slot owner is
// still bad data.
export class SlotTeacherRoleError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SlotTeacherRoleError'
  }
}

async function assertTeacherRole(teacherAccountId: string): Promise<void> {
  const roles = await listAccountRoles(teacherAccountId)
  if (!roles.includes('teacher')) {
    throw new SlotTeacherRoleError(
      `Account ${teacherAccountId} does not have the 'teacher' role; refusing to create a slot for it.`,
    )
  }
}

export async function createSlot(
  input: CreateSlotInput,
): Promise<LessonSlot> {
  const validation = validateSlotInput(input)
  if (validation) {
    throw new Error(`slot/${validation.field}/${validation.reason}`)
  }
  if (input.tariffId !== undefined && input.tariffId !== null) {
    if (!UUID_PATTERN.test(input.tariffId)) {
      throw new Error('slot/tariffId/invalid')
    }
  }
  await assertTeacherRole(input.teacherAccountId)
  const pool = getDbPool()
  const result = await pool.query(
    `insert into lesson_slots (
       teacher_account_id, start_at, duration_minutes, notes, tariff_id, events
     ) values ($1, $2, $3, $4, $5, $6::jsonb)
     returning ${SLOT_COLUMNS}`,
    [
      input.teacherAccountId,
      input.startAt,
      input.durationMinutes,
      input.notes ?? null,
      input.tariffId ?? null,
      JSON.stringify([
        {
          type: 'slot.created',
          at: new Date().toISOString(),
          actor: 'admin',
        },
      ]),
    ],
  )
  return rowToSlot(result.rows[0])
}

export async function bulkCreateSlots(
  input: BulkCreateInput,
): Promise<BulkCreateResult> {
  const validation = validateSlotInput({
    teacherAccountId: input.teacherAccountId,
    durationMinutes: input.durationMinutes,
    notes: input.notes ?? null,
  })
  if (validation) {
    throw new Error(`slot/${validation.field}/${validation.reason}`)
  }
  if (!Array.isArray(input.slots) || input.slots.length === 0) {
    throw new Error('slot/slots/empty')
  }
  if (input.slots.length > 200) {
    throw new Error('slot/slots/too_many')
  }
  for (const s of input.slots) {
    const v = validateSlotInput({ startAt: s.startAt })
    if (v) throw new Error(`slot/${v.field}/${v.reason}`)
  }
  if (input.tariffId !== undefined && input.tariffId !== null) {
    if (!UUID_PATTERN.test(input.tariffId)) {
      throw new Error('slot/tariffId/invalid')
    }
  }
  await assertTeacherRole(input.teacherAccountId)

  const pool = getDbPool()
  const created: LessonSlot[] = []
  const skipped: string[] = []
  const eventBlob = JSON.stringify([
    {
      type: 'slot.created',
      at: new Date().toISOString(),
      actor: 'admin',
      payload: { source: 'bulk' },
    },
  ])

  const client = await pool.connect()
  try {
    await client.query('begin')
    for (const s of input.slots) {
      try {
        const result = await client.query(
          // Migration 0035 turned lesson_slots_teacher_start_unique
          // into a PARTIAL unique index (where status <> 'cancelled').
          // ON CONFLICT with a target column-list against a partial
          // index needs the index predicate too; the simpler shape is
          // `on conflict do nothing`, which catches a violation on
          // any unique index and skips. The legacy semantics are
          // preserved: a (teacher,start_at) collision with a
          // non-cancelled row is idempotent-skipped.
          `insert into lesson_slots (
             teacher_account_id, start_at, duration_minutes, notes, tariff_id, events
           ) values ($1, $2, $3, $4, $5, $6::jsonb)
           on conflict do nothing
           returning ${SLOT_COLUMNS}`,
          [
            input.teacherAccountId,
            s.startAt,
            input.durationMinutes,
            input.notes ?? null,
            input.tariffId ?? null,
            eventBlob,
          ],
        )
        if (result.rows[0]) {
          created.push(rowToSlot(result.rows[0]))
        } else {
          skipped.push(s.startAt)
        }
      } catch (err) {
        // Single-row failure aborts the whole batch — operator picked
        // these slots manually, partial commit would be confusing.
        await client.query('rollback')
        throw err
      }
    }
    await client.query('commit')
  } finally {
    client.release()
  }

  return { created, skippedConflicts: skipped }
}

export async function editOpenSlot(
  slotId: string,
  patch: { startAt?: string; durationMinutes?: number; notes?: string | null },
): Promise<EditOpenSlotResult> {
  if (!UUID_PATTERN.test(slotId)) return { ok: false, reason: 'not_found' }
  const validation = validateSlotInput(patch)
  if (validation) {
    throw new Error(`slot/${validation.field}/${validation.reason}`)
  }
  const pool = getDbPool()
  const result = await pool.query(
    `update lesson_slots
        set start_at = case when $2 then $3::timestamptz else start_at end,
            duration_minutes = case when $4 then $5::int else duration_minutes end,
            notes = case when $6 then $7 else notes end,
            updated_at = now(),
            events = $8::jsonb || events
      where id = $1
        and status = 'open'
      returning ${SLOT_COLUMNS}`,
    [
      slotId,
      'startAt' in patch,
      patch.startAt ?? null,
      'durationMinutes' in patch,
      patch.durationMinutes ?? null,
      'notes' in patch,
      patch.notes ?? null,
      appendEventSql('slot.edited', 'admin', patch as Record<string, unknown>),
    ],
  )
  if (result.rows[0]) return { ok: true, slot: rowToSlot(result.rows[0]) }
  // 0 rows updated. Distinguish "row missing" from "row exists but
  // not-open" so the route can map to the right HTTP status.
  const probe = await pool.query(
    `select 1 from lesson_slots where id = $1 limit 1`,
    [slotId],
  )
  return { ok: false, reason: probe.rowCount ? 'not_open' : 'not_found' }
}

// Wave A — calendar drag-to-move. Open-only at the data layer
// (booked / completed / cancelled slots immovable) per Codex round 1
// #3 + plan v4. Returns explicit verdict so the calendar UI can:
//   - on `not_open`: snap the slot back visually + show a toast
//     ("Слот уже забронирован" / "Перемещать можно только открытые")
//   - on `slot_collision`: snap back + toast ("В это время уже есть
//     другой слот этого преподавателя")
//   - on `not_found`: redirect to error
//   - on success: re-fetch calendar to refresh
//
// Domain validations (cross-midnight / 30-min alignment / business
// hours) happen BEFORE hitting the DB; the route handler is responsible
// for those. The CHECK constraints from migration 0031 are the last
// line of defence.
export async function moveOpenSlot(
  slotId: string,
  newStartAtIso: string,
  actorAccountId: string,
): Promise<MoveOpenSlotResult> {
  if (!UUID_PATTERN.test(slotId)) return { ok: false, reason: 'not_found' }
  const pool = getDbPool()
  // Atomic UPDATE: only succeeds if status='open'. Mirrors
  // `cancelLearnerSlot` pattern for race-safe single-statement
  // mutation. Unique-constraint violation → caught and mapped to
  // `slot_collision`.
  try {
    const result = await pool.query(
      `update lesson_slots
          set start_at = $2,
              updated_at = now(),
              events = $3::jsonb || events
        where id = $1
          and status = 'open'
        returning ${SLOT_COLUMNS}`,
      [
        slotId,
        newStartAtIso,
        appendEventSql('slot.moved', 'admin', {
          newStartAt: newStartAtIso,
          actorAccountId,
        }),
      ],
    )
    if (result.rows[0]) {
      return { ok: true, slot: rowToSlot(result.rows[0]) }
    }
  } catch (err) {
    // Postgres unique violation = 23505. The composite unique on
    // (teacher_account_id, start_at) catches collisions.
    if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === '23505') {
      return { ok: false, reason: 'slot_collision' }
    }
    throw err
  }
  // Sniff to disambiguate not_found vs not_open.
  const sniff = await pool.query(
    `select status from lesson_slots where id = $1`,
    [slotId],
  )
  if (sniff.rows.length === 0) return { ok: false, reason: 'not_found' }
  return { ok: false, reason: 'not_open' }
}

// Wave C — teacher-owned move. Same race-safe contract as
// `moveOpenSlot` but adds an ownership clause to the WHERE so a
// teacher can ONLY move slots they own (status=open AND
// teacher_account_id=session). The ownership lives IN the UPDATE,
// not in a route-level read-then-check, so a teacher cannot
// time-of-check-vs-time-of-use a stale read against another
// teacher's slot. Codex 2026-05-08 prescription.
export async function moveOpenSlotByTeacher(
  slotId: string,
  newStartAtIso: string,
  teacherAccountId: string,
): Promise<MoveTeacherSlotResult> {
  if (!UUID_PATTERN.test(slotId)) return { ok: false, reason: 'not_found' }
  if (!UUID_PATTERN.test(teacherAccountId)) {
    return { ok: false, reason: 'not_found' }
  }
  const pool = getDbPool()
  try {
    const result = await pool.query(
      `update lesson_slots
          set start_at = $2,
              updated_at = now(),
              events = $4::jsonb || events
        where id = $1
          and status = 'open'
          and teacher_account_id = $3
        returning ${SLOT_COLUMNS}`,
      [
        slotId,
        newStartAtIso,
        teacherAccountId,
        appendEventSql('slot.moved', 'teacher', {
          newStartAt: newStartAtIso,
          actorAccountId: teacherAccountId,
        }),
      ],
    )
    if (result.rows[0]) {
      return { ok: true, slot: rowToSlot(result.rows[0]) }
    }
  } catch (err) {
    if (
      err &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code: string }).code === '23505'
    ) {
      return { ok: false, reason: 'slot_collision' }
    }
    throw err
  }
  // Disambiguate: read existing row to classify the no-op.
  const sniff = await pool.query(
    `select status, teacher_account_id from lesson_slots where id = $1`,
    [slotId],
  )
  if (sniff.rows.length === 0) return { ok: false, reason: 'not_found' }
  if (sniff.rows[0].teacher_account_id !== teacherAccountId) {
    return { ok: false, reason: 'not_owner' }
  }
  return { ok: false, reason: 'not_open' }
}

export async function deleteOpenSlot(
  slotId: string,
): Promise<DeleteOpenSlotResult> {
  if (!UUID_PATTERN.test(slotId)) return { ok: false, reason: 'not_found' }
  const pool = getDbPool()
  const result = await pool.query(
    `delete from lesson_slots where id = $1 and status = 'open'`,
    [slotId],
  )
  if ((result.rowCount ?? 0) > 0) return { ok: true }
  const probe = await pool.query(
    `select 1 from lesson_slots where id = $1 limit 1`,
    [slotId],
  )
  return { ok: false, reason: probe.rowCount ? 'not_open' : 'not_found' }
}
