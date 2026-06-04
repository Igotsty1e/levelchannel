// Integration tests for POST /api/auth/invite-preview — Sub-PR C4.
//
// 3 cases:
//   1. Valid token → teacherName returned.
//   2. Missing token field → 400 invite_token_missing.
//   3. Unknown/bad token → 404 invite_not_found.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { POST as registerHandler } from '@/app/api/auth/register/route'
import { POST as loginHandler } from '@/app/api/auth/login/route'
import { POST as createInviteHandler } from '@/app/api/teacher/invites/route'
import { POST as invitePreviewHandler } from '@/app/api/auth/invite-preview/route'
import {
  getAccountByEmail,
  grantAccountRole,
  markAccountVerified,
} from '@/lib/auth/accounts'
import { upsertAccountProfile } from '@/lib/auth/profiles'

import '../setup'
import { buildRequest, extractSessionCookie } from '../helpers'

vi.mock('@/lib/email/dispatch', () => ({
  sendVerifyEmail: vi.fn().mockResolvedValue({ ok: true }),
  sendAlreadyRegisteredEmail: vi.fn().mockResolvedValue({ ok: true }),
  sendPasswordResetEmail: vi.fn().mockResolvedValue({ ok: true }),
}))

const TEST_SECRET = 'ip-test-auth-rate-limit-secret-aaaaaaaaaaaaaaaaaaa'
const TEACHER_INVITE_SECRET =
  'ip-test-teacher-invite-secret-aaaaaaaaaaaaaaaaaaaaaaaaa'

beforeAll(() => {
  process.env.AUTH_RATE_LIMIT_SECRET = TEST_SECRET
  process.env.TEACHER_INVITE_SECRET = TEACHER_INVITE_SECRET
})

afterAll(() => {
  delete process.env.AUTH_RATE_LIMIT_SECRET
  delete process.env.TEACHER_INVITE_SECRET
})

async function regTeacher(email: string, displayName: string) {
  const password = 'StrongPassword123'
  await registerHandler(
    buildRequest('/api/auth/register', {
      body: { email, password, personalDataConsentAccepted: true },
    }),
  )
  const created = await getAccountByEmail(email)
  await markAccountVerified(created!.id)
  await grantAccountRole(created!.id, 'teacher', null)
  // Don't pass firstName/lastName — upsertAccountProfile recomputes
  // display_name from (first, last) when either field is present in
  // the PATCH, overriding the explicit displayName.
  await upsertAccountProfile(created!.id, {
    displayName,
    timezone: 'Europe/Moscow',
  })
  const login = await loginHandler(
    buildRequest('/api/auth/login', { body: { email, password } }),
  )
  return {
    cookie: extractSessionCookie(login.headers.get('Set-Cookie'))!,
    accountId: created!.id,
  }
}

describe('POST /api/auth/invite-preview', () => {
  it('returns inviter display name for a valid token', async () => {
    const teacher = await regTeacher(
      'ip-valid-teacher@example.com',
      'Ольга Преподаватель',
    )
    const createRes = await createInviteHandler(
      buildRequest('/api/teacher/invites', {
        cookie: teacher.cookie,
        body: {},
      }),
    )
    expect(createRes.status).toBe(200)
    const created = await createRes.json()
    const token = decodeURIComponent(
      (created.url as string).match(/invite=([^&]+)/)![1],
    )

    const r = await invitePreviewHandler(
      buildRequest('/api/auth/invite-preview', { body: { inviteToken: token } }),
    )
    expect(r.status).toBe(200)
    const body = await r.json()
    expect(body.ok).toBe(true)
    expect(body.teacherName).toBe('Ольга Преподаватель')
  })

  it('returns 400 invite_token_missing when body has no token', async () => {
    const r = await invitePreviewHandler(
      buildRequest('/api/auth/invite-preview', { body: {} }),
    )
    expect(r.status).toBe(400)
    const body = await r.json()
    expect(body.error).toBe('invite_token_missing')
  })

  it('returns 404 invite_not_found for an unknown/bad token', async () => {
    const r = await invitePreviewHandler(
      buildRequest('/api/auth/invite-preview', {
        body: { inviteToken: 'not-a-real.token-bytes' },
      }),
    )
    expect(r.status).toBe(404)
    const body = await r.json()
    expect(body.error).toBe('invite_not_found')
  })
})
