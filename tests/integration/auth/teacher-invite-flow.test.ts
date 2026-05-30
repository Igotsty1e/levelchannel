import { describe, expect, it, vi, beforeAll } from 'vitest'

import { POST as registerHandler } from '@/app/api/auth/register/route'
import {
  GET as listInvitesHandler,
  POST as createInviteHandler,
} from '@/app/api/teacher/invites/route'
import { POST as revokeInviteHandler } from '@/app/api/teacher/invites/[id]/revoke/route'
import { getAccountByEmail, grantAccountRole } from '@/lib/auth/accounts'
import { getAuthPool } from '@/lib/auth/pool'
import { createSession, SESSION_COOKIE_NAME } from '@/lib/auth/sessions'
import {
  signInviteToken,
  verifyInviteToken,
  TEACHER_INVITE_DEFAULT_TTL_SECONDS,
} from '@/lib/auth/teacher-invites'

import '../setup'
import { buildRequest } from '../helpers'

// SAAS-3+4 TINV.8 — security-critical integration tests for the
// invite-link flow. Goes against live Postgres via the docker setup.
// Covers the load-bearing claims from
// docs/plans/teacher-self-reg-invite.md:
//   - TINV.6.3 happy path: register-via-invite binds learner to teacher
//   - TINV.6.4 HMAC tamper: tampered token → unbound account
//   - TINV.6.7-redeem ROLE-LOSS: inviter promoted to admin → redeem fails
//   - TINV.6.7-list cross-teacher isolation
//   - TINV.6.7-revoke cross-teacher 404
//   - Already-used invite → second redeem returns 409
//   - Expired invite → redeem fails closed
//
// Heavier cases (concurrent race, ±5ms timing symmetry, 23505
// normalisation) are TINV.8-followup; this file pins the security
// claims that ship today (PR #292).

// Mock the email dispatch + bcrypt so the integration suite stays fast.
vi.mock('@/lib/email/dispatch', () => ({
  sendVerifyEmail: vi.fn().mockResolvedValue({ ok: true }),
  sendAlreadyRegisteredEmail: vi.fn().mockResolvedValue({ ok: true }),
  sendPasswordResetEmail: vi.fn().mockResolvedValue({ ok: true }),
}))
vi.mock('@/lib/auth/password', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/password')>()
  return {
    ...actual,
    hashPassword: vi.fn().mockResolvedValue('$2a$12$mockhashmockhashmockhashmockhashmockhashmockhashmockha'),
    verifyPassword: vi.fn().mockResolvedValue(false),
  }
})

const TEST_SECRET = 'test-teacher-invite-secret-for-integration-test-suite-aaa'

beforeAll(() => {
  process.env.TEACHER_INVITE_SECRET = TEST_SECRET
})

async function registerTeacher(email: string): Promise<string> {
  const res = await registerHandler(
    buildRequest('/api/auth/register', {
      body: {
        email,
        password: 'integration test password value',
        personalDataConsentAccepted: true,
        role: 'teacher',
      },
    }),
  )
  expect(res.status).toBe(200)
  const account = await getAccountByEmail(email)
  expect(account).not.toBeNull()
  // Force-verify so requireTeacherAndVerified passes.
  const pool = getAuthPool()
  await pool.query(
    `update accounts set email_verified_at = now() where id = $1`,
    [account!.id],
  )
  return account!.id
}

async function teacherSessionCookie(teacherId: string): Promise<string> {
  const session = await createSession({ accountId: teacherId })
  return `${SESSION_COOKIE_NAME}=${session.cookieValue}`
}

describe('TINV.8 — teacher invite-link integration', () => {
  it('TINV.6.3 happy path: register-via-invite binds assigned_teacher_id', async () => {
    const teacherId = await registerTeacher('happy-teacher@example.com')
    const cookie = await teacherSessionCookie(teacherId)

    // 1. Teacher generates an invite.
    const createRes = await createInviteHandler(
      buildRequest('/api/teacher/invites', { body: {}, cookie }),
    )
    expect(createRes.status).toBe(200)
    const created = await createRes.json()
    expect(created.ok).toBe(true)
    expect(created.url).toMatch(/\/register\?invite=/)

    // 2. Extract the token from the URL.
    const tokenMatch = (created.url as string).match(/invite=([^&]+)/)
    expect(tokenMatch).not.toBeNull()
    const token = decodeURIComponent(tokenMatch![1])
    const payload = verifyInviteToken(token)
    expect(payload).not.toBeNull()
    expect(payload!.tid).toBe(teacherId)

    // 3. Learner registers via the invite.
    const regRes = await registerHandler(
      buildRequest('/api/auth/register', {
        body: {
          email: 'invited-learner@example.com',
          password: 'integration test password value',
          personalDataConsentAccepted: true,
          inviteToken: token,
        },
      }),
    )
    expect(regRes.status).toBe(200)
    const learner = await getAccountByEmail('invited-learner@example.com')
    expect(learner).not.toBeNull()
    // Back-compat alias still set (dual-write through MVP).
    expect(learner!.assignedTeacherId).toBe(teacherId)
    // SAAS-PIVOT Day 2 (2026-05-22) — n:m canonical SoT is the
    // learner_teacher_links table. Assert the row was inserted by the
    // atomic redeem CTE. `getAccountByEmail` does not populate
    // assignedTeacherIds (it's session-only); we verify via direct DB
    // query.
    const pool = getAuthPool()
    const linkRow = await pool.query(
      `select teacher_account_id, via_invite_id, unlinked_at
         from learner_teacher_links
        where learner_account_id = $1`,
      [learner!.id],
    )
    expect(linkRow.rows).toHaveLength(1)
    expect(linkRow.rows[0].teacher_account_id).toBe(teacherId)
    expect(linkRow.rows[0].unlinked_at).toBeNull()

    // 4. DB: invite row is marked used + used_by_account_id set.
    // Reuse the pool declared above (line 129) for the link assertion.
    const inviteRow = await pool.query(
      `select used_at, used_by_account_id from teacher_invites where id = $1`,
      [created.id],
    )
    expect(inviteRow.rows[0].used_at).not.toBeNull()
    expect(inviteRow.rows[0].used_by_account_id).toBe(learner!.id)
  })

  it('TINV.6.4 HMAC tamper: tampered token silently strips → unbound learner', async () => {
    const teacherId = await registerTeacher('hmac-tamper-teacher@example.com')
    const cookie = await teacherSessionCookie(teacherId)
    const createRes = await createInviteHandler(
      buildRequest('/api/teacher/invites', { body: {}, cookie }),
    )
    const { url } = await createRes.json()
    const token = decodeURIComponent((url as string).match(/invite=([^&]+)/)![1])
    // Flip FIRST char of HMAC (same as the unit-test fix in #305):
    // last-char flips can land on base64 padding bits and decode to
    // the same bytes — first-char flips always change the high byte.
    const [payloadEnc, hmac] = token.split('.')
    const firstChar = hmac.slice(0, 1)
    const flippedFirst = firstChar === 'A' ? 'B' : 'A'
    const tampered = payloadEnc + '.' + flippedFirst + hmac.slice(1)

    const regRes = await registerHandler(
      buildRequest('/api/auth/register', {
        body: {
          email: 'tampered-learner@example.com',
          password: 'integration test password value',
          personalDataConsentAccepted: true,
          inviteToken: tampered,
        },
      }),
    )
    expect(regRes.status).toBe(200)
    const learner = await getAccountByEmail('tampered-learner@example.com')
    expect(learner).not.toBeNull()
    // Tampered HMAC → server silently strips invite; learner created
    // but NOT bound. The invite stays unused.
    expect(learner!.assignedTeacherId).toBeNull()

    const pool = getAuthPool()
    const inviteRow = await pool.query(
      `select used_at from teacher_invites where teacher_account_id = $1`,
      [teacherId],
    )
    expect(inviteRow.rows[0].used_at).toBeNull()
  })

  it('TINV.6.7-redeem ROLE-LOSS: inviter promoted to admin → redeem fails 409', async () => {
    const teacherId = await registerTeacher('role-loss-teacher@example.com')
    const cookie = await teacherSessionCookie(teacherId)
    const createRes = await createInviteHandler(
      buildRequest('/api/teacher/invites', { body: {}, cookie }),
    )
    const { url } = await createRes.json()
    const token = decodeURIComponent((url as string).match(/invite=([^&]+)/)![1])

    // Operator promotes teacher to admin: per
    // lib/auth/accounts.ts:279 this strips the consumer `teacher` role.
    await grantAccountRole(teacherId, 'admin', null)

    // Learner attempts to redeem the now-stale invite.
    const regRes = await registerHandler(
      buildRequest('/api/auth/register', {
        body: {
          email: 'after-promotion-learner@example.com',
          password: 'integration test password value',
          personalDataConsentAccepted: true,
          inviteToken: token,
        },
      }),
    )
    expect(regRes.status).toBe(409)
    const errBody = await regRes.json()
    expect(errBody.error).toBe('invite_already_used_or_expired')

    // The redeem CTE's EXISTS subquery must have failed because role
    // is no longer 'teacher'. Account creation is preserved (loose
    // failure mode per TINV.3+4 spec), so the learner DOES exist but
    // without a teacher binding.
    const learner = await getAccountByEmail('after-promotion-learner@example.com')
    expect(learner).not.toBeNull()
    expect(learner!.assignedTeacherId).toBeNull()
  })

  it('TINV.6.3-replay already-used invite → second redeem fails 409', async () => {
    const teacherId = await registerTeacher('replay-teacher@example.com')
    const cookie = await teacherSessionCookie(teacherId)
    const createRes = await createInviteHandler(
      buildRequest('/api/teacher/invites', { body: {}, cookie }),
    )
    const { url } = await createRes.json()
    const token = decodeURIComponent((url as string).match(/invite=([^&]+)/)![1])

    // First redeem succeeds.
    const ok = await registerHandler(
      buildRequest('/api/auth/register', {
        body: {
          email: 'first-learner@example.com',
          password: 'integration test password value',
          personalDataConsentAccepted: true,
          inviteToken: token,
        },
      }),
    )
    expect(ok.status).toBe(200)

    // Second redeem with the same token + different email → 409.
    const replay = await registerHandler(
      buildRequest('/api/auth/register', {
        body: {
          email: 'second-learner@example.com',
          password: 'integration test password value',
          personalDataConsentAccepted: true,
          inviteToken: token,
        },
      }),
    )
    expect(replay.status).toBe(409)
  })

  it('TINV.6.expired: expired invite → redeem fails 409', async () => {
    const teacherId = await registerTeacher('expired-teacher@example.com')
    const cookie = await teacherSessionCookie(teacherId)
    const createRes = await createInviteHandler(
      buildRequest('/api/teacher/invites', { body: {}, cookie }),
    )
    const { id, url } = await createRes.json()
    const token = decodeURIComponent((url as string).match(/invite=([^&]+)/)![1])

    // Force the DB row to expired (in the past). The HMAC verify still
    // passes (since exp is in the payload, not signed against now), but
    // the DB-state check in redeemInviteAndBindLearnerAtomic fails.
    const pool = getAuthPool()
    await pool.query(
      `update teacher_invites set expires_at = now() - interval '1 hour' where id = $1`,
      [id],
    )

    const regRes = await registerHandler(
      buildRequest('/api/auth/register', {
        body: {
          email: 'expired-target@example.com',
          password: 'integration test password value',
          personalDataConsentAccepted: true,
          inviteToken: token,
        },
      }),
    )
    // verifyInviteToken's `exp` is taken from the payload, NOT from
    // the DB. Since the payload's exp is still 7-days-in-future
    // (we just moved the DB row), HMAC verify passes — but the DB
    // WHERE `expires_at > now()` filter inside the redeem CTE fails.
    // So the redeem CTE returns 0 rows → null → 409.
    expect(regRes.status).toBe(409)
  })

  it('TINV.6.7-list cross-teacher isolation: GET only returns own invites', async () => {
    const teacherA = await registerTeacher('teacher-a@example.com')
    const teacherB = await registerTeacher('teacher-b@example.com')

    const cookieA = await teacherSessionCookie(teacherA)
    const cookieB = await teacherSessionCookie(teacherB)

    // A creates 2 invites, B creates 1.
    await createInviteHandler(
      buildRequest('/api/teacher/invites', { body: {}, cookie: cookieA }),
    )
    await createInviteHandler(
      buildRequest('/api/teacher/invites', { body: {}, cookie: cookieA }),
    )
    await createInviteHandler(
      buildRequest('/api/teacher/invites', { body: {}, cookie: cookieB }),
    )

    const listA = await listInvitesHandler(
      buildRequest('/api/teacher/invites', { method: 'GET', cookie: cookieA }),
    )
    const dataA = await listA.json()
    expect(dataA.ok).toBe(true)
    expect(dataA.invites).toHaveLength(2)

    const listB = await listInvitesHandler(
      buildRequest('/api/teacher/invites', { method: 'GET', cookie: cookieB }),
    )
    const dataB = await listB.json()
    expect(dataB.invites).toHaveLength(1)
  })

  it('TINV.6.7-revoke cross-teacher: A cannot revoke B invite → 404', async () => {
    const teacherA = await registerTeacher('revoker-a@example.com')
    const teacherB = await registerTeacher('victim-b@example.com')

    const cookieA = await teacherSessionCookie(teacherA)
    const cookieB = await teacherSessionCookie(teacherB)

    const bCreated = await createInviteHandler(
      buildRequest('/api/teacher/invites', { body: {}, cookie: cookieB }),
    )
    const { id: bInviteId } = await bCreated.json()

    // A attempts to revoke B's invite.
    const revokeRes = await revokeInviteHandler(
      buildRequest(`/api/teacher/invites/${bInviteId}/revoke`, {
        body: {},
        cookie: cookieA,
      }),
      { params: Promise.resolve({ id: bInviteId }) },
    )
    expect(revokeRes.status).toBe(404)

    // DB: B's invite is still active.
    const pool = getAuthPool()
    const row = await pool.query(
      `select revoked_at from teacher_invites where id = $1`,
      [bInviteId],
    )
    expect(row.rows[0].revoked_at).toBeNull()
  })

  it('TINV.6.6 audit-event-types drift: TS tuple matches SQL CHECK', async () => {
    const pool = getAuthPool()
    const checkRow = await pool.query<{ definition: string }>(
      `select pg_get_constraintdef(c.oid) as definition
         from pg_constraint c
         join pg_class t on t.oid = c.conrelid
        where t.relname = 'auth_audit_events'
          and c.conname = 'auth_audit_events_event_type_check'`,
    )
    const def = checkRow.rows[0].definition
    // The 4 new event types must be in the CHECK; AUTH_AUDIT_EVENT_TYPES
    // unit test catches the TS side (tests/auth/teacher-invites.test.ts
    // family). This integration test pins the SQL side.
    expect(def).toContain("'auth.teacher.self_registered'")
    expect(def).toContain("'auth.invite.created'")
    expect(def).toContain("'auth.invite.revoked'")
    expect(def).toContain("'auth.invite.redeemed'")
    // SAAS-OFFER bundle (Sub-A.2-3-5, 2026-05-30) round-2 WARN#1 closure —
    // mig 0096 widened the CHECK with two new event types; pin both here
    // so a future drop accidentally silently breaking the SQL CHECK
    // surfaces as a failing drift test.
    expect(def).toContain("'auth.teacher.saas_offer_accepted'")
    expect(def).toContain("'auth.teacher.saas_offer_backfilled'")
  })
})

// Reference back to the sign helper to silence unused-import warnings
// in TS strict mode (the helper is used inline above via verifyInviteToken).
void signInviteToken
void TEACHER_INVITE_DEFAULT_TTL_SECONDS
