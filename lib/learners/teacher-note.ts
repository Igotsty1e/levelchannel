// Epic C — учительская заметка на ученике (per-teacher).
//
// Plan: docs/plans/clever-sprouting-floyd.md Epic C.
//
// Хранение — колонка learner_teacher_links.teacher_note (mig 0137).
// Per-teacher семантика: уникальная заметка для каждой пары
// (teacher_account_id, learner_account_id) — это PK таблицы.
//
// Контракт:
//   - getLearnerTeacherNote(teacherId, learnerId): прочитать заметку.
//     Возвращает строку или null если заметки нет (или связь не
//     активна; учитель не должен видеть отвязанного ученика).
//   - upsertLearnerTeacherNote(teacherId, learnerId, note): записать.
//     `note` тримится, превращается в null если пустой; >2000 → throw
//     (этим валидирует и API-роут, и DB CHECK constraint — defence
//     in depth).

import { getDbPool } from '@/lib/db/pool'

export const MAX_TEACHER_NOTE_LENGTH = 2000

export type LearnerTeacherNote =
  | { ok: true; note: string | null }
  | { ok: false; reason: 'not_linked' }

export async function getLearnerTeacherNote(
  teacherAccountId: string,
  learnerAccountId: string,
): Promise<LearnerTeacherNote> {
  const pool = getDbPool()
  const result = await pool.query<{ teacher_note: string | null }>(
    `select teacher_note
       from learner_teacher_links
      where teacher_account_id = $1::uuid
        and learner_account_id = $2::uuid
        and unlinked_at is null
      limit 1`,
    [teacherAccountId, learnerAccountId],
  )
  if (result.rows.length === 0) return { ok: false, reason: 'not_linked' }
  return { ok: true, note: result.rows[0].teacher_note ?? null }
}

export type SaveLearnerTeacherNoteResult =
  | { ok: true; note: string | null }
  | { ok: false; reason: 'not_linked' | 'note_too_long' }

/**
 * Сохранить (или очистить) учительскую заметку.
 *
 * `note` тримим. Пустая строка → null (NULL в БД). >2000 → reject.
 * UPDATE возвращает 0 rows если связь не активна или ученик не
 * принадлежит этому учителю — ответ `not_linked`.
 */
export async function upsertLearnerTeacherNote(
  teacherAccountId: string,
  learnerAccountId: string,
  note: string | null,
): Promise<SaveLearnerTeacherNoteResult> {
  const trimmed = typeof note === 'string' ? note.trim() : null
  const normalized = trimmed && trimmed.length > 0 ? trimmed : null
  if (normalized !== null && normalized.length > MAX_TEACHER_NOTE_LENGTH) {
    return { ok: false, reason: 'note_too_long' }
  }
  const pool = getDbPool()
  const result = await pool.query<{ teacher_note: string | null }>(
    `update learner_teacher_links
        set teacher_note = $3
      where teacher_account_id = $1::uuid
        and learner_account_id = $2::uuid
        and unlinked_at is null
      returning teacher_note`,
    [teacherAccountId, learnerAccountId, normalized],
  )
  if (result.rowCount === 0) {
    return { ok: false, reason: 'not_linked' }
  }
  return { ok: true, note: result.rows[0].teacher_note ?? null }
}
