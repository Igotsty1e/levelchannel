// Integration tests for Plan G — POST /api/auth/login with
// optional `inviteToken` body.
//
// 4 cases:
//   1. login OK + valid invite → 200 + inviteRedeem: 'ok' + learner
//      bound to teacher (learner_teacher_links row exists).
//   2. login OK + invalid token (HMAC fail) → 200 + inviteRedeem: 'invalid'.
//   3. login OK + already-used token → 200 + inviteRedeem: 'already_used'.
//   4. login OK + no inviteToken → 200 (no inviteRedeem field at all).

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { POST as registerHandler } from '@/app/api/auth/register/route'
import { POST as loginHandler } from '@/app/api/auth/login/route'
import { POST as createInviteHandler } from '@/app/api/teacher/invites/route'
import {
  getAccountByEmail,
  grantAccountRole,
  markAccountVerified,
} from '@/lib/auth/accounts'
import { getDbPool } from '@/lib/db/pool'

import '../setup'
import { buildRequest, extractSessionCookie } from '../helpers'

vi.mock('@/lib/email/dispatch', () => ({
  sendVerifyEmail: vi.fn().mockResolvedValue({ ok: true }),
  sendAlreadyRegisteredEmail: vi.fn().mockResolvedValue({ ok: true }),
  sendPasswordResetEmail: vi.fn().mockResolvedValue({ ok: true }),
}))

const TEST_SECRET = 'lir-test-auth-rate-limit-secret-aaaaaaaaaaaaaaaaa'
const TEACHER_INVITE_SECRET =
  'lir-test-teacher-invite-secret-aaaaaaaaaaaaaaaaaaaaaa'

beforeAll(() => {
  process.env.AUTH_RATE_LIMIT_SECRET = TEST_SECRET
  process.env.TEACHER_INVITE_SECRET = TEACHER_INVITE_SECRET
})

afterAll(() => {
  delete process.env.AUTH_RATE_LIMIT_SECRET
  delete process.env.TEACHER_INVITE_SECRET
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
    password,
  }
}

async function makeInviteToken(teacherCookie: string): Promise<string> {
  const createRes = await createInviteHandler(
    buildRequest('/api/teacher/invites', {
      cookie: teacherCookie,
      body: {},
    }),
  )
  expect(createRes.status).toBe(200)
  const data = await createRes.json()
  return decodeURIComponent((data.url as string).match(/invite=([^&]+)/)![1])
}

describe('POST /api/auth/login — invite redeem (Plan G)', () => {
  it('redeems a valid token + binds the learner to the teacher', async () => {
    const teacher = await reg('lir-valid-teacher@example.com', { role: 'teacher' })
    const learner = await reg('lir-valid-learner@example.com')
    const token = await makeInviteToken(teacher.cookie)

    const r = await loginHandler(
      buildRequest('/api/auth/login', {
        body: {
          email: 'lir-valid-learner@example.com',
          password: learner.password,
          inviteToken: token,
        },
      }),
    )
    expect(r.status).toBe(200)
    const body = await r.json()
    expect(body.inviteRedeem).toBe('ok')

    // learner_teacher_links row written by the CTE.
    const link = await getDbPool().query<{ exists: boolean }>(
      `select exists(
         select 1 from learner_teacher_links
          where learner_account_id = $1::uuid
            and teacher_account_id = $2::uuid
            and unlinked_at is null
       ) as exists`,
      [learner.accountId, teacher.accountId],
    )
    expect(link.rows[0]?.exists).toBe(true)
  })

  it('returns inviteRedeem: invalid on a HMAC-failing token', async () => {
    const learner = await reg('lir-invalid-token@example.com')
    const r = await loginHandler(
      buildRequest('/api/auth/login', {
        body: {
          email: 'lir-invalid-token@example.com',
          password: learner.password,
          inviteToken: 'totally.not-a-real-token-bytes',
        },
      }),
    )
    expect(r.status).toBe(200)
    const body = await r.json()
    expect(body.inviteRedeem).toBe('invalid')
  })

  it('returns inviteRedeem: already_used on a redeemed token', async () => {
    const teacher = await reg('lir-used-teacher@example.com', { role: 'teacher' })
    const firstLearner = await reg('lir-used-first@example.com')
    const secondLearner = await reg('lir-used-second@example.com')
    const token = await makeInviteToken(teacher.cookie)
    // First login redeems the token.
    const first = await loginHandler(
      buildRequest('/api/auth/login', {
        body: {
          email: 'lir-used-first@example.com',
          password: firstLearner.password,
          inviteToken: token,
        },
      }),
    )
    expect(first.status).toBe(200)
    expect((await first.json()).inviteRedeem).toBe('ok')

    // Second login with same token → already_used.
    const second = await loginHandler(
      buildRequest('/api/auth/login', {
        body: {
          email: 'lir-used-second@example.com',
          password: secondLearner.password,
          inviteToken: token,
        },
      }),
    )
    expect(second.status).toBe(200)
    expect((await second.json()).inviteRedeem).toBe('already_used')
  })

  it('login without inviteToken returns no inviteRedeem field', async () => {
    const learner = await reg('lir-no-token@example.com')
    const r = await loginHandler(
      buildRequest('/api/auth/login', {
        body: {
          email: 'lir-no-token@example.com',
          password: learner.password,
        },
      }),
    )
    expect(r.status).toBe(200)
    const body = await r.json()
    expect(body.inviteRedeem).toBeUndefined()
  })
})
