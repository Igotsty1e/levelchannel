// Integration tests for getTeacherPlanLearnerLimit — onboarding
// Sub-PR B4. Pins:
//   - unlimited (no active subscription → free baseline; learner_limit
//     comes from teacher_subscription_plans).
//   - limited (active subscription with finite learner_limit).
//   - active learner count derived from learner_teacher_links.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { POST as registerHandler } from '@/app/api/auth/register/route'
import { POST as loginHandler } from '@/app/api/auth/login/route'
import {
  getAccountByEmail,
  grantAccountRole,
  markAccountVerified,
} from '@/lib/auth/accounts'
import { getDbPool } from '@/lib/db/pool'
import { getTeacherPlanLearnerLimit } from '@/lib/onboarding/teacher-plan-limit'

import '../setup'
import { buildRequest, extractSessionCookie } from '../helpers'

vi.mock('@/lib/email/dispatch', () => ({
  sendVerifyEmail: vi.fn().mockResolvedValue({ ok: true }),
  sendAlreadyRegisteredEmail: vi.fn().mockResolvedValue({ ok: true }),
  sendPasswordResetEmail: vi.fn().mockResolvedValue({ ok: true }),
}))

const TEST_SECRET = 'tpl-test-auth-rate-limit-secret-aaaaaaaaaaaaaaaaa'

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
  const login = await loginHandler(
    buildRequest('/api/auth/login', { body: { email, password } }),
  )
  return {
    cookie: extractSessionCookie(login.headers.get('Set-Cookie'))!,
    accountId: created!.id,
  }
}

async function setSubscription(
  accountId: string,
  planSlug: string,
): Promise<void> {
  const pool = getDbPool()
  await pool.query(
    `insert into teacher_subscriptions (account_id, plan_slug, state, created_at, updated_at)
     values ($1::uuid, $2, 'active', now(), now())
     on conflict (account_id) do update
       set plan_slug = excluded.plan_slug, state = 'active', updated_at = now()`,
    [accountId, planSlug],
  )
}

async function linkLearner(
  teacherAccountId: string,
  learnerEmailSeed: string,
): Promise<void> {
  const pool = getDbPool()
  const learner = await regTeacher(`tpl-learner-${learnerEmailSeed}@example.com`)
  // regTeacher granted teacher role — drop it (the test wants a learner).
  await pool.query(
    `delete from account_roles where account_id = $1::uuid and role = 'teacher'`,
    [learner.accountId],
  )
  await pool.query(
    `insert into learner_teacher_links (learner_account_id, teacher_account_id, linked_at)
     values ($1::uuid, $2::uuid, now())`,
    [learner.accountId, teacherAccountId],
  )
}

describe('getTeacherPlanLearnerLimit', () => {
  it('teacher without active subscription → defaults to free tier with learner_limit=1', async () => {
    const teacher = await regTeacher('tpl-no-sub@example.com')
    const result = await getTeacherPlanLearnerLimit(teacher.accountId)
    expect(result.kind).toBe('limited')
    if (result.kind === 'limited') {
      // Default fallback uses 'free' slug; learner_limit comes from
      // teacher_subscription_plans seed (free.learner_limit = 1 per
      // mig 0073 + bug-4 Sub-PR A rename).
      expect(result.planSlug).toBe('free')
      expect(result.limit).toBe(1)
      expect(result.activeCount).toBe(0)
    }
  })

  it('teacher on free with 0 active learners → activeCount=0, limit=1', async () => {
    const teacher = await regTeacher('tpl-free-zero@example.com')
    await setSubscription(teacher.accountId, 'free')
    const result = await getTeacherPlanLearnerLimit(teacher.accountId)
    expect(result).toMatchObject({
      kind: 'limited',
      planSlug: 'free',
      limit: 1,
      activeCount: 0,
    })
  })

  it('teacher on free with 1 active learner → activeCount=1 (hard limit boundary)', async () => {
    const teacher = await regTeacher('tpl-free-one@example.com')
    await setSubscription(teacher.accountId, 'free')
    await linkLearner(teacher.accountId, 'free-one')
    const result = await getTeacherPlanLearnerLimit(teacher.accountId)
    expect(result).toMatchObject({
      kind: 'limited',
      planSlug: 'free',
      limit: 1,
      activeCount: 1,
    })
  })

  it('teacher on operator-managed → unlimited (banner hidden)', async () => {
    const teacher = await regTeacher('tpl-op-managed@example.com')
    await setSubscription(teacher.accountId, 'operator-managed')
    const result = await getTeacherPlanLearnerLimit(teacher.accountId)
    expect(result).toEqual({ kind: 'unlimited' })
  })
})
