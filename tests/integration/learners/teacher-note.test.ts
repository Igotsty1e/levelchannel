// Epic C — учительская заметка о ученике (2026-06-18).
//
// Plan: docs/plans/clever-sprouting-floyd.md Epic C.
//
// Контракт:
//   - get/upsert per-teacher: учитель A не видит заметку учителя B на
//     одного и того же ученика.
//   - тримминг + '' → null.
//   - >2000 char → reject (помимо app-level — DB CHECK constraint).
//   - not_linked → 'not_linked' ошибка (если unlinked_at IS NOT NULL).

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { POST as registerHandler } from '@/app/api/auth/register/route'
import { POST as loginHandler } from '@/app/api/auth/login/route'
import {
  getAccountByEmail,
  grantAccountRole,
  markAccountVerified,
} from '@/lib/auth/accounts'
import { getDbPool } from '@/lib/db/pool'
import {
  MAX_TEACHER_NOTE_LENGTH,
  getLearnerTeacherNote,
  upsertLearnerTeacherNote,
} from '@/lib/learners/teacher-note'

import { buildRequest } from '../helpers'
import '../setup'

vi.mock('@/lib/email/dispatch', () => ({
  sendVerifyEmail: vi.fn().mockResolvedValue({ ok: true }),
  sendAlreadyRegisteredEmail: vi.fn().mockResolvedValue({ ok: true }),
  sendPasswordResetEmail: vi.fn().mockResolvedValue({ ok: true }),
}))

const TEST_SECRET = 'lc-note-test-auth-rate-limit-secret-aaaaaaaaaaaaaaa'

beforeAll(() => {
  process.env.AUTH_RATE_LIMIT_SECRET = TEST_SECRET
})

afterAll(() => {
  delete process.env.AUTH_RATE_LIMIT_SECRET
})

async function regTeacher(email: string) {
  const password = 'StrongPassword123'
  await registerHandler(
    buildRequest('/api/auth/register', {
      body: { email, password, personalDataConsentAccepted: true },
    }),
  )
  const created = await getAccountByEmail(email)
  await markAccountVerified(created!.id)
  await grantAccountRole(created!.id, 'teacher', null)
  await loginHandler(
    buildRequest('/api/auth/login', { body: { email, password } }),
  )
  return { accountId: created!.id }
}

async function freshLearnerAccount(email: string): Promise<string> {
  const pool = getDbPool()
  const teacher = await regTeacher(email)
  // регистр teacher → пере-роль на 'student' (учеников БД называет
  // 'student' per mig 0006 CHECK constraint).
  await pool.query(
    `delete from account_roles where account_id = $1::uuid and role = 'teacher'`,
    [teacher.accountId],
  )
  await pool.query(
    `insert into account_roles (account_id, role)
       values ($1::uuid, 'student')
       on conflict do nothing`,
    [teacher.accountId],
  )
  return teacher.accountId
}

async function linkLearner(
  teacherId: string,
  learnerId: string,
): Promise<void> {
  const pool = getDbPool()
  await pool.query(
    `insert into learner_teacher_links (learner_account_id, teacher_account_id, linked_at)
       values ($1::uuid, $2::uuid, now())
       on conflict do nothing`,
    [learnerId, teacherId],
  )
}

describe('learner_teacher_links.teacher_note (Epic C 2026-06-18)', () => {
  it('default — нет заметки → note=null', async () => {
    const teacher = await regTeacher('lc-note-default-teacher@example.com')
    const learnerId = await freshLearnerAccount(
      'lc-note-default-learner@example.com',
    )
    await linkLearner(teacher.accountId, learnerId)

    const result = await getLearnerTeacherNote(teacher.accountId, learnerId)
    expect(result).toEqual({ ok: true, note: null })
  })

  it('upsert + get — заметка сохраняется и возвращается тем же учителем', async () => {
    const teacher = await regTeacher('lc-note-rw-teacher@example.com')
    const learnerId = await freshLearnerAccount(
      'lc-note-rw-learner@example.com',
    )
    await linkLearner(teacher.accountId, learnerId)

    const save = await upsertLearnerTeacherNote(
      teacher.accountId,
      learnerId,
      'Готовится к ЕГЭ. Слабая алгебра.',
    )
    expect(save).toEqual({
      ok: true,
      note: 'Готовится к ЕГЭ. Слабая алгебра.',
    })

    const fetched = await getLearnerTeacherNote(teacher.accountId, learnerId)
    expect(fetched).toEqual({
      ok: true,
      note: 'Готовится к ЕГЭ. Слабая алгебра.',
    })
  })

  it('per-teacher isolation — другой учитель видит null', async () => {
    const teacherA = await regTeacher('lc-note-iso-A@example.com')
    const teacherB = await regTeacher('lc-note-iso-B@example.com')
    const learnerId = await freshLearnerAccount(
      'lc-note-iso-learner@example.com',
    )
    await linkLearner(teacherA.accountId, learnerId)
    await linkLearner(teacherB.accountId, learnerId)

    await upsertLearnerTeacherNote(
      teacherA.accountId,
      learnerId,
      'Заметка только для A',
    )

    const aRead = await getLearnerTeacherNote(teacherA.accountId, learnerId)
    const bRead = await getLearnerTeacherNote(teacherB.accountId, learnerId)
    expect(aRead).toEqual({ ok: true, note: 'Заметка только для A' })
    expect(bRead).toEqual({ ok: true, note: null })

    // Teacher B пишет — A.заметка не меняется.
    await upsertLearnerTeacherNote(
      teacherB.accountId,
      learnerId,
      'Заметка только для B',
    )
    const aReread = await getLearnerTeacherNote(teacherA.accountId, learnerId)
    expect(aReread).toEqual({ ok: true, note: 'Заметка только для A' })
  })

  it('пустая строка / пробелы → нормализуется в null', async () => {
    const teacher = await regTeacher('lc-note-empty-teacher@example.com')
    const learnerId = await freshLearnerAccount(
      'lc-note-empty-learner@example.com',
    )
    await linkLearner(teacher.accountId, learnerId)

    await upsertLearnerTeacherNote(
      teacher.accountId,
      learnerId,
      'Какая-то заметка',
    )
    const cleared = await upsertLearnerTeacherNote(
      teacher.accountId,
      learnerId,
      '   ',
    )
    expect(cleared).toEqual({ ok: true, note: null })
    const fetched = await getLearnerTeacherNote(teacher.accountId, learnerId)
    expect(fetched).toEqual({ ok: true, note: null })
  })

  it('boundary length 2000 — accept', async () => {
    const teacher = await regTeacher('lc-note-bound-teacher@example.com')
    const learnerId = await freshLearnerAccount(
      'lc-note-bound-learner@example.com',
    )
    await linkLearner(teacher.accountId, learnerId)

    const exact = 'x'.repeat(MAX_TEACHER_NOTE_LENGTH)
    const save = await upsertLearnerTeacherNote(
      teacher.accountId,
      learnerId,
      exact,
    )
    expect(save.ok).toBe(true)
    if (save.ok) expect(save.note?.length).toBe(MAX_TEACHER_NOTE_LENGTH)
  })

  it('2001 char → note_too_long, ничего не пишется в БД', async () => {
    const teacher = await regTeacher('lc-note-toolong-teacher@example.com')
    const learnerId = await freshLearnerAccount(
      'lc-note-toolong-learner@example.com',
    )
    await linkLearner(teacher.accountId, learnerId)

    const tooLong = 'x'.repeat(MAX_TEACHER_NOTE_LENGTH + 1)
    const save = await upsertLearnerTeacherNote(
      teacher.accountId,
      learnerId,
      tooLong,
    )
    expect(save).toEqual({ ok: false, reason: 'note_too_long' })
    const fetched = await getLearnerTeacherNote(teacher.accountId, learnerId)
    expect(fetched).toEqual({ ok: true, note: null })
  })

  it('not_linked — учитель пишет про чужого ученика → ошибка', async () => {
    const teacher = await regTeacher('lc-note-noauth-teacher@example.com')
    const otherTeacher = await regTeacher('lc-note-noauth-other@example.com')
    const learnerId = await freshLearnerAccount(
      'lc-note-noauth-learner@example.com',
    )
    // ученик привязан только к other teacher, не teacher.
    await linkLearner(otherTeacher.accountId, learnerId)

    const result = await upsertLearnerTeacherNote(
      teacher.accountId,
      learnerId,
      'Не должно сохраниться',
    )
    expect(result).toEqual({ ok: false, reason: 'not_linked' })
  })

  it('unlinked link — заметка не возвращается + upsert fails', async () => {
    const teacher = await regTeacher('lc-note-unlinked-teacher@example.com')
    const learnerId = await freshLearnerAccount(
      'lc-note-unlinked-learner@example.com',
    )
    const pool = getDbPool()
    await pool.query(
      `insert into learner_teacher_links (learner_account_id, teacher_account_id, linked_at, unlinked_at)
         values ($1::uuid, $2::uuid, now() - interval '7 days', now() - interval '1 day')`,
      [learnerId, teacher.accountId],
    )

    const read = await getLearnerTeacherNote(teacher.accountId, learnerId)
    expect(read).toEqual({ ok: false, reason: 'not_linked' })
    const write = await upsertLearnerTeacherNote(
      teacher.accountId,
      learnerId,
      'попытка',
    )
    expect(write).toEqual({ ok: false, reason: 'not_linked' })
  })
})
