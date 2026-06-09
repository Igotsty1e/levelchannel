// Integration tests for shouldShowLearnerCabinetTour — Sub-PR C1.
// Trigger contract: hasTeacher && noCompletion && !dismissed.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { POST as registerHandler } from '@/app/api/auth/register/route'
import { POST as loginHandler } from '@/app/api/auth/login/route'
import { POST as dismissHandler } from '@/app/api/onboarding/dismiss-hint/route'
import {
  getAccountByEmail,
  grantAccountRole,
  markAccountVerified,
} from '@/lib/auth/accounts'
import { getDbPool } from '@/lib/db/pool'
import { shouldShowLearnerCabinetTour } from '@/lib/onboarding/learner-cabinet-tour'

import '../setup'
import { buildRequest, extractSessionCookie } from '../helpers'

vi.mock('@/lib/email/dispatch', () => ({
  sendVerifyEmail: vi.fn().mockResolvedValue({ ok: true }),
  sendAlreadyRegisteredEmail: vi.fn().mockResolvedValue({ ok: true }),
  sendPasswordResetEmail: vi.fn().mockResolvedValue({ ok: true }),
}))

const TEST_SECRET = 'lct-test-auth-rate-limit-secret-aaaaaaaaaaaaaaaaa'

beforeAll(() => {
  process.env.AUTH_RATE_LIMIT_SECRET = TEST_SECRET
})

afterAll(() => {
  delete process.env.AUTH_RATE_LIMIT_SECRET
})

async function reg(
  email: string,
  opts: { role?: 'admin' | 'teacher' | 'student' } = {},
) {
  const password = 'StrongPassword123'
  await registerHandler(
    buildRequest('/api/auth/register', {
      body: { email, password, personalDataConsentAccepted: true },
    }),
  )
  const created = await getAccountByEmail(email)
  await markAccountVerified(created!.id)
  if (opts.role) await grantAccountRole(created!.id, opts.role, null)
  const login = await loginHandler(
    buildRequest('/api/auth/login', { body: { email, password } }),
  )
  return {
    cookie: extractSessionCookie(login.headers.get('Set-Cookie'))!,
    accountId: created!.id,
  }
}

async function linkTeacherLearner(
  teacherAccountId: string,
  learnerAccountId: string,
): Promise<void> {
  await getDbPool().query(
    `insert into learner_teacher_links (learner_account_id, teacher_account_id, linked_at)
     values ($1::uuid, $2::uuid, now())`,
    [learnerAccountId, teacherAccountId],
  )
}

describe('shouldShowLearnerCabinetTour', () => {
  it('learner with no teacher → false', async () => {
    const learner = await reg('lct-no-teacher@example.com')
    expect(await shouldShowLearnerCabinetTour(learner.accountId)).toBe(false)
  })

  it('learner with a teacher link AND no completed lesson AND not dismissed → true', async () => {
    const teacher = await reg('lct-teacher-active@example.com', { role: 'teacher' })
    const learner = await reg('lct-learner-active@example.com')
    await linkTeacherLearner(teacher.accountId, learner.accountId)
    expect(await shouldShowLearnerCabinetTour(learner.accountId)).toBe(true)
  })

  it('after dismissing via API → false', async () => {
    const teacher = await reg('lct-teacher-dismiss@example.com', { role: 'teacher' })
    const learner = await reg('lct-learner-dismiss@example.com')
    await linkTeacherLearner(teacher.accountId, learner.accountId)
    expect(await shouldShowLearnerCabinetTour(learner.accountId)).toBe(true)

    const r = await dismissHandler(
      buildRequest('/api/onboarding/dismiss-hint', {
        cookie: learner.cookie,
        body: { hintKey: 'learner_cabinet_tour' },
      }),
    )
    expect(r.status).toBe(200)
    expect(await shouldShowLearnerCabinetTour(learner.accountId)).toBe(false)
  })

  it('after a completed lesson → false', async () => {
    const teacher = await reg('lct-teacher-completed@example.com', { role: 'teacher' })
    const learner = await reg('lct-learner-completed@example.com')
    await linkTeacherLearner(teacher.accountId, learner.accountId)
    // Seed a slot + completion. Schema: lesson_slots(teacher_account_id, learner_account_id, ...) + lesson_completions(slot_id, teacher_id, amount_kopecks, completed_at).
    const pool = getDbPool()
    // Align start_at to 30-min boundary (lesson_slots CHECK constraint).
    // Pin to yesterday 12:00 Moscow so the row stays inside
    // `lesson_slots_start_in_business_hours` (06:00-22:00 MSK)
    // regardless of UTC wall clock — `now() - 2 hours` was flaky when
    // CI ran during early-UTC hours (pre-06:00 Moscow).
    const slot = await pool.query<{ id: string }>(
      `insert into lesson_slots (teacher_account_id, learner_account_id, start_at, duration_minutes, status, created_at)
       values (
         $1::uuid,
         $2::uuid,
         (date_trunc('day', now() at time zone 'Europe/Moscow') - interval '1 day' + interval '12 hours') at time zone 'Europe/Moscow',
         60,
         'completed',
         now()
       )
       returning id`,
      [teacher.accountId, learner.accountId],
    )
    await pool.query(
      `insert into lesson_completions (slot_id, teacher_id, was_no_show, amount_kopecks, completed_at)
       values ($1::uuid, $2::uuid, false, 100000, now() - interval '1 hour')`,
      [slot.rows[0].id, teacher.accountId],
    )
    expect(await shouldShowLearnerCabinetTour(learner.accountId)).toBe(false)
  })
})
