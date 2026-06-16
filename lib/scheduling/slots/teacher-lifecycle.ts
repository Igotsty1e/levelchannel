// Wave-2 lesson-history (2026-06-16) — teacher-scope mark-completed +
// mark-no-show. Тонкая обёртка над `markSlotLifecycle` с двумя добавками:
//
//   1. Pre-ownership check (paranoia B-1): запрашиваем slot и проверяем
//      `teacher_account_id === actorAccountId` до делегирования.
//      Helper-level anti-spoof тоже есть, но 403 явно из route чище и
//      даёт нам fast-fail без открытой транзакции.
//
//   2. Post-commit Wave-A dispatch: уведомление ученику best-effort.
//      Помещаем после `markSlotLifecycle`, чтобы dispatch не запускался
//      на rollback. См. lib/notifications/lesson-event-dispatch.ts.
//
// API повторяет существующий admin markSlotLifecycle для совместимости.
// Idempotency (paranoia B-2): UNIQUE(slot_id) на lesson_completions —
// первый вызов вставит, повторный вернёт `not_booked` (уже не booked).
// Это нормальный UX-feedback для double-click.

import { getDbPool } from '@/lib/db/pool'

import {
  markSlotLifecycle,
  type SlotLifecycleStatus,
  type LessonSlot,
} from './index'

export type MarkSlotByTeacherResult =
  | { ok: true; slot: LessonSlot; recipientAccountId: string | null }
  | {
      ok: false
      reason:
        | 'not_found'
        | 'not_owner'
        | 'not_booked'
        | 'not_yet_started'
        | 'missing_snapshot'
    }

export async function markSlotByTeacher(
  slotId: string,
  teacherAccountId: string,
  status: SlotLifecycleStatus,
): Promise<MarkSlotByTeacherResult> {
  const pool = getDbPool()
  const pre = await pool.query(
    `select teacher_account_id, learner_account_id
       from lesson_slots where id = $1`,
    [slotId],
  )
  if (pre.rows.length === 0) return { ok: false, reason: 'not_found' }
  const ownerId = String(pre.rows[0].teacher_account_id)
  if (ownerId !== teacherAccountId) {
    return { ok: false, reason: 'not_owner' }
  }
  const learnerId = pre.rows[0].learner_account_id
    ? String(pre.rows[0].learner_account_id)
    : null

  const result = await markSlotLifecycle(slotId, status, teacherAccountId)
  if (!result.ok) {
    if (result.reason === 'wrong_teacher') {
      return { ok: false, reason: 'not_owner' }
    }
    if (
      result.reason === 'not_found'
      || result.reason === 'not_booked'
      || result.reason === 'not_yet_started'
      || result.reason === 'missing_snapshot'
    ) {
      return { ok: false, reason: result.reason }
    }
    return { ok: false, reason: 'not_found' }
  }
  return { ok: true, slot: result.slot, recipientAccountId: learnerId }
}
