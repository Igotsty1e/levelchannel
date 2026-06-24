// teacher-lessons-edit-status epic (2026-06-24) — backend mutations
// for /api/teacher/slots/[id]/change-status и /api/teacher/personal-events/[id]/change-status.
//
// Plan: docs/plans/teacher-lessons-edit-status-2026-06-24.md §1.1 / §1.2.
//
// КОНТРАКТ:
//   - Inline SQL внутри одной TX, НЕ переиспользует helpers с собственным
//     begin/commit (markSlotByTeacher, markLessonCompleted, completePersonalEvent etc).
//   - Advisory lock `pkg_consume:<learnerId>` для уроков (match существующих
//     slot-writers в booking.ts/mutations-reschedule.ts/mutations-assign-direct.ts).
//     Деla НЕ берут advisory — single-teacher resource, row lock достаточен.
//   - 48h immutability + settlement + earnings gates ДЛЯ уроков (transitions
//     которые трогают lesson_completions через DELETE).
//   - Audit insert внутри той же TX (notify_intent + notify_dispatched_at семантика).
//   - expectedUpdatedAt token → 409 stale.

import type { PoolClient } from 'pg'

import { getDbPool } from '@/lib/db/pool'

const FORTY_EIGHT_HOURS_MS = 48 * 60 * 60 * 1000

// Read-model rowToSlot rounds updated_at to second precision via
// `new Date(String(row.updated_at)).toISOString()` (legacy quirk).
// Clients send back that second-precision token, but SELECT FOR UPDATE
// returns full ms-precision Date. Compare and emit in second-precision
// to match what the client observes.
function isoSeconds(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value)
  const sec = Math.floor(date.getTime() / 1000) * 1000
  return new Date(sec).toISOString()
}

export type LessonTargetStatus =
  | 'completed'
  | 'no_show_learner'
  | 'no_show_teacher'
  | 'booked'

export type DealTargetStatus = 'personal_event' | 'completed' | 'cancelled'

export type ChangeLessonStatusResult =
  | { ok: true; newUpdatedAt: string }
  | {
      ok: false
      reason:
        | 'not_found'
        | 'not_owner'
        | 'wrong_kind'
        | 'cannot_edit_cancelled'
        | 'stale'
        | 'immutable'
        | 'settled'
        | 'accrued'
        | 'missing_snapshot'
        | 'invalid_transition'
        | 'not_yet_ended'
    }

export type ChangeDealStatusResult =
  | { ok: true; newUpdatedAt: string }
  | {
      ok: false
      reason: 'not_found' | 'not_owner' | 'wrong_kind' | 'stale' | 'invalid_transition'
    }

export type ChangeLessonStatusInput = {
  slotId: string
  teacherAccountId: string
  toStatus: LessonTargetStatus
  expectedUpdatedAt: string
  notifyIntent: boolean
}

export type ChangeDealStatusInput = {
  slotId: string
  teacherAccountId: string
  toStatus: DealTargetStatus
  expectedUpdatedAt: string
}

type SlotRow = {
  id: string
  teacher_account_id: string
  learner_account_id: string | null
  status: string
  source: string | null
  updated_at: string
  tariff_id: string | null
  duration_minutes: number
  start_at: string
  snapshot_amount_kopecks: number | null
}

type CompletionRow = {
  id: string
  created_at: string
  immutable_at: string | null
  was_no_show: boolean
}

export async function changeLessonStatus(
  input: ChangeLessonStatusInput,
): Promise<ChangeLessonStatusResult> {
  const pool = getDbPool()
  const client = await pool.connect()
  try {
    await client.query('begin')

    // Step 1: pre-read для learner_account_id (нужен для advisory key).
    const pre = await client.query<SlotRow>(
      `select id, teacher_account_id, learner_account_id, status, source, updated_at, tariff_id, duration_minutes, start_at, snapshot_amount_kopecks
         from lesson_slots where id = $1`,
      [input.slotId],
    )
    if (pre.rows.length === 0) {
      await client.query('rollback')
      return { ok: false, reason: 'not_found' }
    }
    const preRow = pre.rows[0]
    if (preRow.teacher_account_id !== input.teacherAccountId) {
      await client.query('rollback')
      return { ok: false, reason: 'not_owner' }
    }
    if (preRow.source === 'personal_event') {
      await client.query('rollback')
      return { ok: false, reason: 'wrong_kind' }
    }
    if (preRow.status === 'cancelled') {
      await client.query('rollback')
      return { ok: false, reason: 'cannot_edit_cancelled' }
    }
    if (!preRow.learner_account_id) {
      // Booked lesson без ученика — невозможно (контракт), но безопасно отказать.
      await client.query('rollback')
      return { ok: false, reason: 'invalid_transition' }
    }

    // Step 2: advisory lock per-learner. Match existing slot-writers contract.
    await client.query(
      `select pg_advisory_xact_lock(hashtext('pkg_consume:' || $1::text))`,
      [preRow.learner_account_id],
    )

    // Step 3: SELECT FOR UPDATE + stale check.
    const lock = await client.query<SlotRow>(
      `select id, teacher_account_id, learner_account_id, status, source, updated_at, tariff_id, duration_minutes, start_at, snapshot_amount_kopecks
         from lesson_slots where id = $1 for update`,
      [input.slotId],
    )
    const row = lock.rows[0]
    if (isoSeconds(row.updated_at) !== isoSeconds(input.expectedUpdatedAt)) {
      await client.query('rollback')
      return { ok: false, reason: 'stale' }
    }

    // B-3 fix: past-only gate. Match с existing markLessonCompleted
    // semantics (lib/teacher-ledger/mark-lesson-completed.ts:120-125).
    // change-status позиционирован как «изменить статус прошлого занятия»;
    // future slot не должен принимать any transition (e.g. booked → no_show_teacher).
    const endMs =
      new Date(row.start_at).getTime() + Number(row.duration_minutes) * 60_000
    if (Date.now() < endMs) {
      await client.query('rollback')
      return { ok: false, reason: 'not_yet_ended' }
    }

    const fromStatus = row.status as LessonTargetStatus
    if (fromStatus === input.toStatus) {
      await client.query('rollback')
      return { ok: false, reason: 'invalid_transition' }
    }

    // Step 4: если transition включает DELETE existing completion — проверить gates.
    const willDeleteCompletion =
      (fromStatus === 'completed' || fromStatus === 'no_show_learner') &&
      (input.toStatus === 'booked' || input.toStatus === 'no_show_teacher')

    const completionQ = await client.query<CompletionRow>(
      `select id, created_at, immutable_at, was_no_show
         from lesson_completions where slot_id = $1 for update`,
      [input.slotId],
    )
    const completionRow = completionQ.rows[0] ?? null

    if (willDeleteCompletion && completionRow) {
      const createdMs = new Date(completionRow.created_at).getTime()
      const elapsed = Date.now() - createdMs
      if (completionRow.immutable_at !== null || elapsed >= FORTY_EIGHT_HOURS_MS) {
        await client.query('rollback')
        return { ok: false, reason: 'immutable' }
      }
      const settled = await client.query(
        `select 1 from lesson_settlement_completions where completion_id = $1 limit 1`,
        [completionRow.id],
      )
      if (settled.rows.length > 0) {
        await client.query('rollback')
        return { ok: false, reason: 'settled' }
      }
      const accrued = await client.query(
        `select 1 from teacher_earnings where related_completion_id = $1 limit 1`,
        [completionRow.id],
      )
      if (accrued.rows.length > 0) {
        await client.query('rollback')
        return { ok: false, reason: 'accrued' }
      }
    }

    // Step 5: применить chain mutation. Inline SQL.
    const applied = await applyLessonChainInTx(client, {
      slotId: input.slotId,
      teacherId: input.teacherAccountId,
      learnerId: row.learner_account_id!,
      tariffId: row.tariff_id,
      durationMinutes: row.duration_minutes,
      snapshotAmountKopecks: row.snapshot_amount_kopecks,
      completedAtIso: new Date(endMs).toISOString(),
      fromStatus,
      toStatus: input.toStatus,
      completionRow,
    })
    if (!applied.ok) {
      await client.query('rollback')
      return applied
    }

    // Step 6: bump updated_at + audit row + commit.
    const bump = await client.query<{ updated_at: string }>(
      `update lesson_slots set updated_at = now() where id = $1 returning updated_at`,
      [input.slotId],
    )
    const newUpdatedAt = isoSeconds(bump.rows[0].updated_at)

    await client.query(
      `insert into audit_lesson_status_change
        (slot_id, actor_account_id, actor_role, learner_account_id, source,
         from_status, to_status, notify_intent, notify_dispatched_at)
       values
        ($1, $2, 'teacher', $3, 'lesson', $4, $5, $6, null)`,
      [
        input.slotId,
        input.teacherAccountId,
        row.learner_account_id,
        fromStatus,
        input.toStatus,
        input.notifyIntent,
      ],
    )

    await client.query('commit')
    return { ok: true, newUpdatedAt }
  } catch (err) {
    await client.query('rollback').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

type ApplyChainResult = { ok: true } | { ok: false; reason: 'missing_snapshot' | 'invalid_transition' }

async function applyLessonChainInTx(
  client: PoolClient,
  args: {
    slotId: string
    teacherId: string
    learnerId: string
    tariffId: string | null
    durationMinutes: number
    snapshotAmountKopecks: number | null
    completedAtIso: string
    fromStatus: LessonTargetStatus
    toStatus: LessonTargetStatus
    completionRow: CompletionRow | null
  },
): Promise<ApplyChainResult> {
  const {
    fromStatus,
    toStatus,
    slotId,
    teacherId,
    tariffId,
    snapshotAmountKopecks,
    completedAtIso,
    completionRow,
  } = args

  // Transition matrix (см. plan §What can change для уроков):

  // completed ↔ no_show_learner — UPDATE was_no_show + явный UPDATE slot.status.
  if (fromStatus === 'completed' && toStatus === 'no_show_learner') {
    if (!completionRow) return { ok: false, reason: 'invalid_transition' }
    await client.query(
      `update lesson_completions set was_no_show = true where id = $1`,
      [completionRow.id],
    )
    await client.query(
      `update lesson_slots set status = 'no_show_learner' where id = $1`,
      [slotId],
    )
    return { ok: true }
  }
  if (fromStatus === 'no_show_learner' && toStatus === 'completed') {
    if (!completionRow) return { ok: false, reason: 'invalid_transition' }
    await client.query(
      `update lesson_completions set was_no_show = false where id = $1`,
      [completionRow.id],
    )
    await client.query(
      `update lesson_slots set status = 'completed' where id = $1`,
      [slotId],
    )
    return { ok: true }
  }

  // completed/no_show_learner → booked: DELETE completion. REVERSE trigger
  // переключит slot.status='booked'.
  if (
    (fromStatus === 'completed' || fromStatus === 'no_show_learner') &&
    toStatus === 'booked'
  ) {
    if (!completionRow) return { ok: false, reason: 'invalid_transition' }
    await client.query(`delete from lesson_completions where id = $1`, [completionRow.id])
    return { ok: true }
  }

  // completed/no_show_learner → no_show_teacher: DELETE completion, then UPDATE.
  if (
    (fromStatus === 'completed' || fromStatus === 'no_show_learner') &&
    toStatus === 'no_show_teacher'
  ) {
    if (!completionRow) return { ok: false, reason: 'invalid_transition' }
    await client.query(`delete from lesson_completions where id = $1`, [completionRow.id])
    await client.query(
      `update lesson_slots set status = 'no_show_teacher', marked_at = coalesce(marked_at, now()) where id = $1`,
      [slotId],
    )
    return { ok: true }
  }

  // booked → completed/no_show_learner: INSERT lesson_completions. Forward
  // trigger переключит slot.status. Match canonical writer schema
  // (lib/teacher-ledger/mark-lesson-completed.ts:141-149): columns
  // (slot_id, teacher_id, was_no_show, amount_kopecks, completed_at,
  // marked_by_account_id) — NO learner_id/duration_minutes/tariff_id.
  // amount_kopecks из slot snapshot, completed_at = slot end (start_at + duration).
  if (
    fromStatus === 'booked' &&
    (toStatus === 'completed' || toStatus === 'no_show_learner')
  ) {
    // Match mark-lesson-completed.ts:127-132 contract: tariff_id set
    // but snapshot missing — corrupt state, surface loudly.
    if (snapshotAmountKopecks == null && tariffId != null) {
      return { ok: false, reason: 'missing_snapshot' }
    }
    const amount = snapshotAmountKopecks ?? 0
    await client.query(
      `insert into lesson_completions
        (slot_id, teacher_id, was_no_show, amount_kopecks,
         completed_at, marked_by_account_id)
       values ($1, $2, $3, $4, $5::timestamptz, $2)`,
      [
        slotId,
        teacherId,
        toStatus === 'no_show_learner',
        amount,
        completedAtIso,
      ],
    )
    // Forward trigger ставит slot.status автоматом, но marked_at — нет.
    await client.query(
      `update lesson_slots set marked_at = coalesce(marked_at, now()) where id = $1`,
      [slotId],
    )
    return { ok: true }
  }

  // booked → no_show_teacher: UPDATE без completion (non-billable).
  if (fromStatus === 'booked' && toStatus === 'no_show_teacher') {
    await client.query(
      `update lesson_slots set status = 'no_show_teacher', marked_at = coalesce(marked_at, now()) where id = $1`,
      [slotId],
    )
    return { ok: true }
  }

  // no_show_teacher → booked: UPDATE clear marked_at.
  if (fromStatus === 'no_show_teacher' && toStatus === 'booked') {
    await client.query(
      `update lesson_slots set status = 'booked', marked_at = null where id = $1`,
      [slotId],
    )
    return { ok: true }
  }

  // no_show_teacher → completed/no_show_learner: UPDATE status='booked' + INSERT completion.
  if (
    fromStatus === 'no_show_teacher' &&
    (toStatus === 'completed' || toStatus === 'no_show_learner')
  ) {
    if (snapshotAmountKopecks == null && tariffId != null) {
      return { ok: false, reason: 'missing_snapshot' }
    }
    const amount = snapshotAmountKopecks ?? 0
    // Сначала status='booked' чтобы forward trigger смог перевести в target.
    await client.query(
      `update lesson_slots set status = 'booked', marked_at = null where id = $1`,
      [slotId],
    )
    await client.query(
      `insert into lesson_completions
        (slot_id, teacher_id, was_no_show, amount_kopecks,
         completed_at, marked_by_account_id)
       values ($1, $2, $3, $4, $5::timestamptz, $2)`,
      [
        slotId,
        teacherId,
        toStatus === 'no_show_learner',
        amount,
        completedAtIso,
      ],
    )
    await client.query(
      `update lesson_slots set marked_at = coalesce(marked_at, now()) where id = $1`,
      [slotId],
    )
    return { ok: true }
  }

  return { ok: false, reason: 'invalid_transition' }
}

export async function changeDealStatus(
  input: ChangeDealStatusInput,
): Promise<ChangeDealStatusResult> {
  const pool = getDbPool()
  const client = await pool.connect()
  try {
    await client.query('begin')

    const lock = await client.query<SlotRow>(
      `select id, teacher_account_id, learner_account_id, status, source, updated_at, tariff_id, duration_minutes
         from lesson_slots where id = $1 for update`,
      [input.slotId],
    )
    if (lock.rows.length === 0) {
      await client.query('rollback')
      return { ok: false, reason: 'not_found' }
    }
    const row = lock.rows[0]
    if (row.teacher_account_id !== input.teacherAccountId) {
      await client.query('rollback')
      return { ok: false, reason: 'not_owner' }
    }
    if (row.source !== 'personal_event') {
      await client.query('rollback')
      return { ok: false, reason: 'wrong_kind' }
    }
    if (isoSeconds(row.updated_at) !== isoSeconds(input.expectedUpdatedAt)) {
      await client.query('rollback')
      return { ok: false, reason: 'stale' }
    }

    const fromStatus = row.status as DealTargetStatus
    if (fromStatus === input.toStatus) {
      await client.query('rollback')
      return { ok: false, reason: 'invalid_transition' }
    }

    const applied = await applyDealChainInTx(client, {
      slotId: input.slotId,
      teacherId: input.teacherAccountId,
      fromStatus,
      toStatus: input.toStatus,
    })
    if (!applied.ok) {
      await client.query('rollback')
      return applied
    }

    const bump = await client.query<{ updated_at: string }>(
      `update lesson_slots set updated_at = now() where id = $1 returning updated_at`,
      [input.slotId],
    )
    const newUpdatedAt = isoSeconds(bump.rows[0].updated_at)

    await client.query(
      `insert into audit_lesson_status_change
        (slot_id, actor_account_id, actor_role, learner_account_id, source,
         from_status, to_status, notify_intent, notify_dispatched_at)
       values
        ($1, $2, 'teacher', null, 'deal', $3, $4, false, null)`,
      [input.slotId, input.teacherAccountId, fromStatus, input.toStatus],
    )

    await client.query('commit')
    return { ok: true, newUpdatedAt }
  } catch (err) {
    await client.query('rollback').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

async function applyDealChainInTx(
  client: PoolClient,
  args: {
    slotId: string
    teacherId: string
    fromStatus: DealTargetStatus
    toStatus: DealTargetStatus
  },
): Promise<{ ok: true } | { ok: false; reason: 'invalid_transition' }> {
  const { slotId, teacherId, fromStatus, toStatus } = args

  if (fromStatus === 'completed' && toStatus === 'personal_event') {
    await client.query(
      `update lesson_slots set status = 'personal_event', marked_at = null where id = $1`,
      [slotId],
    )
    return { ok: true }
  }
  if (fromStatus === 'completed' && toStatus === 'cancelled') {
    await client.query(
      `update lesson_slots
          set status = 'cancelled',
              marked_at = null,
              cancelled_at = now(),
              cancelled_by_account_id = $2,
              cancellation_reason = null
        where id = $1`,
      [slotId, teacherId],
    )
    return { ok: true }
  }
  if (fromStatus === 'cancelled' && toStatus === 'personal_event') {
    await client.query(
      `update lesson_slots
          set status = 'personal_event',
              cancelled_at = null,
              cancelled_by_account_id = null,
              cancellation_reason = null
        where id = $1`,
      [slotId],
    )
    return { ok: true }
  }
  if (fromStatus === 'cancelled' && toStatus === 'completed') {
    await client.query(
      `update lesson_slots
          set status = 'completed',
              marked_at = now(),
              cancelled_at = null,
              cancelled_by_account_id = null,
              cancellation_reason = null
        where id = $1`,
      [slotId],
    )
    return { ok: true }
  }
  if (fromStatus === 'personal_event' && toStatus === 'completed') {
    await client.query(
      `update lesson_slots set status = 'completed', marked_at = now() where id = $1`,
      [slotId],
    )
    return { ok: true }
  }
  if (fromStatus === 'personal_event' && toStatus === 'cancelled') {
    await client.query(
      `update lesson_slots
          set status = 'cancelled',
              cancelled_at = now(),
              cancelled_by_account_id = $2,
              cancellation_reason = null
        where id = $1`,
      [slotId, teacherId],
    )
    return { ok: true }
  }

  return { ok: false, reason: 'invalid_transition' }
}
