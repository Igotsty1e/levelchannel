import { describe, expect, it, vi, beforeAll } from 'vitest'

import { GET as bookingDaysGet } from '@/app/api/slots/booking-days/route'
import { POST as registerHandler } from '@/app/api/auth/register/route'
import { POST as createInviteHandler } from '@/app/api/teacher/invites/route'
import { getAccountByEmail, grantAccountRole } from '@/lib/auth/accounts'
import { getAuthPool } from '@/lib/auth/pool'
import {
  SESSION_COOKIE_NAME,
  createSession,
  lookupSession,
} from '@/lib/auth/sessions'
import {
  getActiveTeacherForLearner,
  getActiveTeacherIdsForLearner,
} from '@/lib/auth/teacher-scope'

import '../setup'
import { buildRequest } from '../helpers'

// SAAS-PIVOT Epic 1 Day 2 — n:m current-teacher context contract.
//
// Plan: docs/plans/saas-pivot-master.md §2.5 + §5 Day 2 + §4 Q-7.
//
// Pins the load-bearing claims for the n:m promotion:
//   - getActiveTeacherForLearner returns single / picker / zero shapes.
//   - Atomic invite redeem inserts a learner_teacher_links row (dual-
//     write with accounts.assigned_teacher_id).
//   - Invite to ALREADY-linked learner from a SECOND teacher adds a
//     second link row (Q-7).
//   - Session hydration populates assignedTeacherIds[] in linked_at asc
//     order; back-compat alias = first element.
//   - Booking route with multi-link learner missing ?teacher returns
//     400 needs_teacher_picker.

vi.mock('@/lib/email/dispatch', () => ({
  sendVerifyEmail: vi.fn().mockResolvedValue({ ok: true }),
  sendAlreadyRegisteredEmail: vi.fn().mockResolvedValue({ ok: true }),
  sendPasswordResetEmail: vi.fn().mockResolvedValue({ ok: true }),
}))
vi.mock('@/lib/auth/password', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/password')>()
  return {
    ...actual,
    hashPassword: vi.fn().mockResolvedValue(
      '$2a$12$mockhashmockhashmockhashmockhashmockhashmockhashmockha',
    ),
    verifyPassword: vi.fn().mockResolvedValue(false),
  }
})

const TEST_SECRET = 'test-nm-context-secret-for-integration-test-suite-aaaa'

beforeAll(() => {
  process.env.TEACHER_INVITE_SECRET = TEST_SECRET
})

async function makeAccount(email: string): Promise<string> {
  const pool = getAuthPool()
  const r = await pool.query<{ id: string }>(
    `insert into accounts (email, password_hash, email_verified_at)
       values ($1, 'fake-hash-for-nm-tests', now())
     returning id`,
    [email],
  )
  return r.rows[0].id
}

async function makeTeacher(email: string): Promise<string> {
  const id = await makeAccount(email)
  await grantAccountRole(id, 'teacher', null)
  return id
}

async function link(
  learnerId: string,
  teacherId: string,
  linkedAtSql = 'now()',
): Promise<void> {
  const pool = getAuthPool()
  await pool.query(
    `insert into learner_teacher_links (learner_account_id, teacher_account_id, linked_at)
       values ($1, $2, ${linkedAtSql})
     on conflict (learner_account_id, teacher_account_id) do update
       set unlinked_at = null,
           linked_at = excluded.linked_at`,
    [learnerId, teacherId],
  )
}

async function softUnlink(
  learnerId: string,
  teacherId: string,
): Promise<void> {
  await getAuthPool().query(
    `update learner_teacher_links
        set unlinked_at = now()
      where learner_account_id = $1
        and teacher_account_id = $2`,
    [learnerId, teacherId],
  )
}

describe('SAAS-PIVOT Day 2 — getActiveTeacherForLearner', () => {
  it('returns the single teacher for a learner with exactly one active link', async () => {
    const teacher = await makeTeacher('single-teacher@example.com')
    const learner = await makeAccount('single-learner@example.com')
    await link(learner, teacher)

    const resolved = await getActiveTeacherForLearner(learner)
    expect(resolved.teacherId).toBe(teacher)
    expect(resolved.needsPicker).toBe(false)
  })

  it('returns needsPicker=true for a learner with multiple active links', async () => {
    const teacherA = await makeTeacher('multi-teacher-a@example.com')
    const teacherB = await makeTeacher('multi-teacher-b@example.com')
    const learner = await makeAccount('multi-learner@example.com')
    await link(learner, teacherA)
    await link(learner, teacherB)

    const resolved = await getActiveTeacherForLearner(learner)
    expect(resolved.teacherId).toBeNull()
    expect(resolved.needsPicker).toBe(true)
  })

  it('returns null + needsPicker=false for a learner with zero active links', async () => {
    const learner = await makeAccount('zero-link-learner@example.com')

    const resolved = await getActiveTeacherForLearner(learner)
    expect(resolved.teacherId).toBeNull()
    expect(resolved.needsPicker).toBe(false)
  })

  it('soft-unlinked rows are excluded (unlinked_at IS NULL predicate)', async () => {
    const teacher = await makeTeacher('soft-unlinked-teacher@example.com')
    const learner = await makeAccount('soft-unlinked-learner@example.com')
    await link(learner, teacher)
    await softUnlink(learner, teacher)

    const resolved = await getActiveTeacherForLearner(learner)
    expect(resolved.teacherId).toBeNull()
    expect(resolved.needsPicker).toBe(false)
  })
})

describe('SAAS-PIVOT Day 2 — getActiveTeacherIdsForLearner ordering', () => {
  it('orders by linked_at asc so [0] = oldest active link', async () => {
    const teacherA = await makeTeacher('order-teacher-a@example.com')
    const teacherB = await makeTeacher('order-teacher-b@example.com')
    const learner = await makeAccount('order-learner@example.com')
    // Insert B FIRST in older time, A LATER — array must come back [B, A].
    await link(learner, teacherB, `now() - interval '2 hours'`)
    await link(learner, teacherA, `now() - interval '1 hour'`)

    const ids = await getActiveTeacherIdsForLearner(learner)
    expect(ids).toEqual([teacherB, teacherA])
  })

  it('returns empty array for a learner with no active links', async () => {
    const learner = await makeAccount('empty-array-learner@example.com')
    const ids = await getActiveTeacherIdsForLearner(learner)
    expect(ids).toEqual([])
  })
})

describe('SAAS-PIVOT Day 2 — atomic invite redeem CTE writes both columns', () => {
  it('redeem inserts learner_teacher_links AND sets accounts.assigned_teacher_id (dual-write)', async () => {
    // Make a verified teacher.
    const teacherEmail = 'invite-dual-teacher@example.com'
    const regTeacher = await registerHandler(
      buildRequest('/api/auth/register', {
        body: {
          email: teacherEmail,
          password: 'integration test password value',
          personalDataConsentAccepted: true,
          role: 'teacher',
        },
      }),
    )
    expect(regTeacher.status).toBe(200)
    const teacherAcc = await getAccountByEmail(teacherEmail)
    expect(teacherAcc).not.toBeNull()
    const pool = getAuthPool()
    await pool.query(
      `update accounts set email_verified_at = now() where id = $1`,
      [teacherAcc!.id],
    )

    // Teacher creates an invite.
    const session = await createSession({ accountId: teacherAcc!.id })
    const cookie = `${SESSION_COOKIE_NAME}=${session.cookieValue}`
    const createRes = await createInviteHandler(
      buildRequest('/api/teacher/invites', { body: {}, cookie }),
    )
    expect(createRes.status).toBe(200)
    const { url } = await createRes.json()
    const token = decodeURIComponent((url as string).match(/invite=([^&]+)/)![1])

    // Learner registers via invite.
    const learnerEmail = 'invite-dual-learner@example.com'
    const regRes = await registerHandler(
      buildRequest('/api/auth/register', {
        body: {
          email: learnerEmail,
          password: 'integration test password value',
          personalDataConsentAccepted: true,
          inviteToken: token,
        },
      }),
    )
    expect(regRes.status).toBe(200)
    const learner = await getAccountByEmail(learnerEmail)
    expect(learner).not.toBeNull()

    // Legacy alias set (back-compat dual-write).
    expect(learner!.assignedTeacherId).toBe(teacherAcc!.id)

    // Canonical: exactly one active link row, with via_invite_id set.
    const links = await pool.query(
      `select teacher_account_id, via_invite_id, unlinked_at
         from learner_teacher_links
        where learner_account_id = $1`,
      [learner!.id],
    )
    expect(links.rows).toHaveLength(1)
    expect(links.rows[0].teacher_account_id).toBe(teacherAcc!.id)
    expect(links.rows[0].via_invite_id).not.toBeNull()
    expect(links.rows[0].unlinked_at).toBeNull()
  })

  it('Q-7: redeeming a second invite from teacher B adds a second link row (n:m)', async () => {
    // Two distinct teachers + one learner.
    const teacherAEmail = 'q7-teacher-a@example.com'
    const teacherBEmail = 'q7-teacher-b@example.com'
    for (const email of [teacherAEmail, teacherBEmail]) {
      await registerHandler(
        buildRequest('/api/auth/register', {
          body: {
            email,
            password: 'integration test password value',
            personalDataConsentAccepted: true,
            role: 'teacher',
          },
        }),
      )
    }
    const teacherA = (await getAccountByEmail(teacherAEmail))!
    const teacherB = (await getAccountByEmail(teacherBEmail))!
    const pool = getAuthPool()
    await pool.query(
      `update accounts set email_verified_at = now() where id = any($1)`,
      [[teacherA.id, teacherB.id]],
    )

    // A and B each issue an invite.
    const sessionA = await createSession({ accountId: teacherA.id })
    const sessionB = await createSession({ accountId: teacherB.id })
    const cookieA = `${SESSION_COOKIE_NAME}=${sessionA.cookieValue}`
    const cookieB = `${SESSION_COOKIE_NAME}=${sessionB.cookieValue}`

    const createA = await createInviteHandler(
      buildRequest('/api/teacher/invites', { body: {}, cookie: cookieA }),
    )
    const createB = await createInviteHandler(
      buildRequest('/api/teacher/invites', { body: {}, cookie: cookieB }),
    )
    const tokenA = decodeURIComponent(
      ((await createA.json()).url as string).match(/invite=([^&]+)/)![1],
    )

    // Learner registers via A's invite.
    const learnerEmail = 'q7-learner@example.com'
    await registerHandler(
      buildRequest('/api/auth/register', {
        body: {
          email: learnerEmail,
          password: 'integration test password value',
          personalDataConsentAccepted: true,
          inviteToken: tokenA,
        },
      }),
    )
    const learner = (await getAccountByEmail(learnerEmail))!

    // Learner exists; the second redeem path is the
    // redeemInviteAndBindLearnerAtomic helper called directly with
    // teacher B's invite + the existing learner id (so we don't
    // re-register).
    const tokenB = decodeURIComponent(
      ((await createB.json()).url as string).match(/invite=([^&]+)/)![1],
    )
    const { redeemInviteAndBindLearnerAtomic, verifyInviteToken } =
      await import('@/lib/auth/teacher-invites')
    const payloadB = verifyInviteToken(tokenB)
    expect(payloadB).not.toBeNull()
    const redeemed = await redeemInviteAndBindLearnerAtomic(
      payloadB!.iid,
      learner.id,
    )
    expect(redeemed).not.toBeNull()
    expect(redeemed!.teacherAccountId).toBe(teacherB.id)

    // n:m canonical: BOTH links present.
    const links = await pool.query(
      `select teacher_account_id
         from learner_teacher_links
        where learner_account_id = $1
          and unlinked_at is null
        order by linked_at asc`,
      [learner.id],
    )
    expect(links.rows.map((r) => r.teacher_account_id)).toEqual(
      expect.arrayContaining([teacherA.id, teacherB.id]),
    )
    expect(links.rows).toHaveLength(2)

    // The legacy accounts.assigned_teacher_id column is dual-written
    // by the redeem CTE — the second redeem OVERWRITES the column to
    // teacher B (last writer wins on a single-value field). This is
    // intentional: the column is single-value, the n:m canonical
    // truth is the link table. New readers MUST consume
    // assignedTeacherIds (the session-hydration array) rather than
    // the alias. Verify the exact overwrite shape so the dual-write
    // contract stays pinned.
    const refetched = await getAccountByEmail(learnerEmail)
    expect(refetched!.assignedTeacherId).toBe(teacherB.id)
    // Session hydration (lookupSession) populates assignedTeacherIds
    // from the canonical link table ordered linked_at asc; the alias
    // derived there is [0] which is A (the earliest link).
    const { cookieValue } = await createSession({ accountId: learner.id })
    const looked = await lookupSession(cookieValue)
    expect(looked).not.toBeNull()
    expect(looked!.account.assignedTeacherIds).toEqual([
      teacherA.id,
      teacherB.id,
    ])
    expect(looked!.account.assignedTeacherId).toBe(teacherA.id)
  })
})

describe('SAAS-PIVOT Day 2 — operator reassignment preserves single-teacher semantics', () => {
  it('setAssignedTeacher (admin path) soft-unlinks prior active links when reassigning to a new teacher', async () => {
    const { setAssignedTeacher } = await import('@/lib/auth/accounts')
    const teacherA = await makeTeacher('reassign-teacher-a@example.com')
    const teacherB = await makeTeacher('reassign-teacher-b@example.com')
    const learner = await makeAccount('reassign-learner@example.com')
    // Initial assignment to A.
    await setAssignedTeacher(learner, teacherA)
    let active = await getActiveTeacherIdsForLearner(learner)
    expect(active).toEqual([teacherA])

    // Operator reassigns to B. The legacy single-teacher UI semantics
    // require A's link to soft-unlink atomically. Without this guard,
    // the learner would silently drift to multi-link and routes would
    // start returning 400 needs_teacher_picker after the reassignment.
    await setAssignedTeacher(learner, teacherB)
    active = await getActiveTeacherIdsForLearner(learner)
    expect(active).toEqual([teacherB])

    // The canonical link to A still exists in the table but with
    // unlinked_at set — historical record preserved.
    const pool = getAuthPool()
    const rows = await pool.query(
      `select teacher_account_id, unlinked_at
         from learner_teacher_links
        where learner_account_id = $1
        order by teacher_account_id`,
      [learner],
    )
    const linkA = rows.rows.find((r) => r.teacher_account_id === teacherA)
    const linkB = rows.rows.find((r) => r.teacher_account_id === teacherB)
    expect(linkA).toBeDefined()
    expect(linkA!.unlinked_at).not.toBeNull()
    expect(linkB).toBeDefined()
    expect(linkB!.unlinked_at).toBeNull()
  })

  it('setAssignedTeacher (null = unassign) soft-unlinks every active link', async () => {
    const { setAssignedTeacher } = await import('@/lib/auth/accounts')
    const teacherA = await makeTeacher('unassign-teacher-a@example.com')
    const teacherB = await makeTeacher('unassign-teacher-b@example.com')
    const learner = await makeAccount('unassign-learner@example.com')
    // Two active links (multi-link state via invite redeem semantics).
    await link(learner, teacherA)
    await link(learner, teacherB)

    await setAssignedTeacher(learner, null)
    const active = await getActiveTeacherIdsForLearner(learner)
    expect(active).toEqual([])
  })
})

describe('SAAS-PIVOT Day 2 — session hydration n:m', () => {
  it('lookupSession populates assignedTeacherIds[] from active links in linked_at asc order', async () => {
    const teacherA = await makeTeacher('hydra-teacher-a@example.com')
    const teacherB = await makeTeacher('hydra-teacher-b@example.com')
    const learner = await makeAccount('hydra-learner@example.com')
    // A is older than B.
    await link(learner, teacherA, `now() - interval '2 hours'`)
    await link(learner, teacherB, `now() - interval '1 hour'`)
    // Dual-write the legacy alias to A so the test can also verify
    // the alias is recomputed from the array (not the column).
    await getAuthPool().query(
      `update accounts set assigned_teacher_id = $2 where id = $1`,
      [learner, teacherA],
    )

    const { cookieValue } = await createSession({ accountId: learner })
    const looked = await lookupSession(cookieValue)
    expect(looked).not.toBeNull()
    expect(looked!.account.assignedTeacherIds).toEqual([teacherA, teacherB])
    // Back-compat alias = first element of the array.
    expect(looked!.account.assignedTeacherId).toBe(teacherA)
  })

  it('session hydration handles zero-link learners with empty array + null alias', async () => {
    const learner = await makeAccount('hydra-empty-learner@example.com')
    const { cookieValue } = await createSession({ accountId: learner })
    const looked = await lookupSession(cookieValue)
    expect(looked).not.toBeNull()
    expect(looked!.account.assignedTeacherIds).toEqual([])
    expect(looked!.account.assignedTeacherId).toBeNull()
  })
})

describe('SAAS-PIVOT Day 2 — booking route needs_teacher_picker', () => {
  it('GET /api/slots/booking-days returns 400 needs_teacher_picker for multi-link learner without ?teacher', async () => {
    const teacherA = await makeTeacher('book-teacher-a@example.com')
    const teacherB = await makeTeacher('book-teacher-b@example.com')
    const learner = await makeAccount('book-multi-learner@example.com')
    await link(learner, teacherA)
    await link(learner, teacherB)

    const { cookieValue } = await createSession({ accountId: learner })
    const cookie = `${SESSION_COOKIE_NAME}=${cookieValue}`

    const today = new Date().toISOString().slice(0, 10)
    const future = new Date(Date.now() + 7 * 86_400_000)
      .toISOString()
      .slice(0, 10)
    const res = await bookingDaysGet(
      buildRequest(
        `/api/slots/booking-days?from=${today}&to=${future}&tz=Europe/Moscow`,
        { cookie },
      ),
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('needs_teacher_picker')
  })

  it('GET /api/slots/booking-days accepts ?teacher=<id> when it matches an active link', async () => {
    const teacherA = await makeTeacher('book-ok-teacher-a@example.com')
    const teacherB = await makeTeacher('book-ok-teacher-b@example.com')
    const learner = await makeAccount('book-ok-learner@example.com')
    await link(learner, teacherA)
    await link(learner, teacherB)

    const { cookieValue } = await createSession({ accountId: learner })
    const cookie = `${SESSION_COOKIE_NAME}=${cookieValue}`

    const today = new Date().toISOString().slice(0, 10)
    const future = new Date(Date.now() + 7 * 86_400_000)
      .toISOString()
      .slice(0, 10)
    const res = await bookingDaysGet(
      buildRequest(
        `/api/slots/booking-days?from=${today}&to=${future}&tz=Europe/Moscow&teacher=${teacherA}`,
        { cookie },
      ),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.days).toEqual([])
  })

  it('GET /api/slots/booking-days rejects ?teacher=<foreign-id> with 400 needs_teacher_picker', async () => {
    const teacherA = await makeTeacher('book-foreign-teacher-a@example.com')
    const teacherB = await makeTeacher('book-foreign-teacher-b@example.com')
    // Foreign teacher = a teacher not in the learner's link set.
    const stranger = await makeTeacher('book-foreign-stranger@example.com')
    const learner = await makeAccount('book-foreign-learner@example.com')
    await link(learner, teacherA)
    await link(learner, teacherB)

    const { cookieValue } = await createSession({ accountId: learner })
    const cookie = `${SESSION_COOKIE_NAME}=${cookieValue}`

    const today = new Date().toISOString().slice(0, 10)
    const future = new Date(Date.now() + 7 * 86_400_000)
      .toISOString()
      .slice(0, 10)
    const res = await bookingDaysGet(
      buildRequest(
        `/api/slots/booking-days?from=${today}&to=${future}&tz=Europe/Moscow&teacher=${stranger}`,
        { cookie },
      ),
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('needs_teacher_picker')
  })
})

