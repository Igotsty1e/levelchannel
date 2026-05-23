// Teacher-cabinet-polish (2026-05-23) — TASK-4 Sub-PR E.
//
// Plan: docs/plans/teacher-cabinet-polish.md §3 Sub-PR E + §Q-12.
//
// Round-1 WARN #7 closure — three negative cases beyond happy path:
//   (a) teacher A's session GET /teacher/learners does NOT show
//       teacher B's learners (no cross-tenant leak via the helper);
//   (b) GET /teacher/learners/<learnerOfTeacherB> returns 404
//       (drill-down page already gates; PR #427 contract);
//   (c) GET /teacher/learners/<adminAccountId> returns 404
//       (archetype check — drill-down's link/slot guard rejects
//       non-learner targets that the actor never linked).
//
// Implementation notes:
//   - Happy path + cross-tenant leak are tested at the helper layer
//     (`listLearnersForTeacher`). The page is a thin SSR wrapper that
//     forwards `session.account.id` to this helper; testing the helper
//     covers the page's data contract.
//   - Anti-spoof (b)+(c) are tested by invoking the existing drill-down
//     page function (`app/teacher/learners/[id]/page.tsx`) with
//     `next/headers` + `next/navigation` mocked. The drill-down's
//     `notFound()` throws a tagged error that we assert on.
//   - For (c) the "admin account" is created with role=admin AND a
//     valid UUID — so the drill-down's UUID gate passes and we hit
//     the real link/slot guard. Without an active link AND without any
//     historical lesson_slots row, the guard rejects → 404, regardless
//     of whether the target is a learner, admin, or teacher. This is
//     the "non-learner targets" pin Q12 calls out.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { grantAccountRole } from '@/lib/auth/accounts'
import { getAuthPool } from '@/lib/auth/pool'
import {
  SESSION_COOKIE_NAME,
  createSession,
} from '@/lib/auth/sessions'
import { getDbPool } from '@/lib/db/pool'
import { listLearnersForTeacher } from '@/lib/scheduling/teacher-learners'

import '../setup'

// --- next/headers + next/navigation mocks for the drill-down SSR page.
//
// The drill-down at `app/teacher/learners/[id]/page.tsx` calls
// `cookies()` from `next/headers` to read the session cookie and
// `notFound()` from `next/navigation` to abort with a 404. Both APIs
// only work inside a real Next request; we stub them to (a) deliver a
// teacher's session cookie, (b) capture `notFound()` as a tagged
// thrown error the test can assert.
//
// `redirect()` is stubbed but should not fire in any of these tests —
// the teacher layout (not the page) handles redirects, and we're
// calling the page directly. We make redirect throw a tagged error so
// an accidental redirect surfaces as a test failure.

let mockCookieValue: string | null = null

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === SESSION_COOKIE_NAME && mockCookieValue !== null
        ? { value: mockCookieValue }
        : undefined,
  }),
}))

class NextNotFoundError extends Error {
  digest = 'NEXT_NOT_FOUND'
  constructor() {
    super('NEXT_NOT_FOUND')
  }
}

class NextRedirectError extends Error {
  digest: string
  constructor(url: string) {
    super(`NEXT_REDIRECT;replace;${url};307;`)
    this.digest = `NEXT_REDIRECT;replace;${url};307;`
  }
}

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new NextNotFoundError()
  },
  redirect: (url: string) => {
    throw new NextRedirectError(url)
  },
}))

// Children of teacher-learners-list-page need next/link's default export.
vi.mock('next/link', () => ({
  default: ({ children }: { children: unknown }) => children,
}))

// --- Fixture helpers.

async function makeAccount(email: string): Promise<string> {
  const r = await getAuthPool().query<{ id: string }>(
    `insert into accounts (email, password_hash, email_verified_at)
       values ($1, 'fake-hash-learners-list-tests', now())
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

async function makeLearner(email: string): Promise<string> {
  return await makeAccount(email)
}

async function makeLearnerWithProfile(
  email: string,
  displayName: string,
): Promise<string> {
  const id = await makeAccount(email)
  await getAuthPool().query(
    `insert into account_profiles (account_id, display_name)
       values ($1, $2)
     on conflict (account_id) do update set display_name = excluded.display_name`,
    [id, displayName],
  )
  return id
}

async function makeAdmin(email: string): Promise<string> {
  const id = await makeAccount(email)
  await grantAccountRole(id, 'admin', null)
  return id
}

async function linkLearnerToTeacher(
  learnerId: string,
  teacherId: string,
): Promise<void> {
  await getAuthPool().query(
    `insert into learner_teacher_links (learner_account_id, teacher_account_id, linked_at)
       values ($1, $2, now())
     on conflict (learner_account_id, teacher_account_id) do update
       set unlinked_at = null`,
    [learnerId, teacherId],
  )
}

async function teacherSessionCookieValue(teacherId: string): Promise<string> {
  const { cookieValue } = await createSession({ accountId: teacherId })
  return cookieValue
}

beforeEach(() => {
  mockCookieValue = null
})

afterEach(() => {
  mockCookieValue = null
})

describe('Sub-PR E — /teacher/learners list (helper data contract)', () => {
  it('happy path: teacher A with 2 linked learners → both rows in helper sort', async () => {
    const teacherA = await makeTeacher('e-list-teacher-a@example.com')
    const learner1 = await makeLearnerWithProfile(
      'e-list-l1@example.com',
      'Анна Иванова',
    )
    const learner2 = await makeLearnerWithProfile(
      'e-list-l2@example.com',
      'Борис Петров',
    )
    await linkLearnerToTeacher(learner1, teacherA)
    await linkLearnerToTeacher(learner2, teacherA)

    const rows = await listLearnersForTeacher(teacherA)

    expect(rows).toHaveLength(2)
    // Both are assigned (is_assigned=true). Activity counts are zero
    // (no slots / no completions). The tertiary sort is email ASC, so
    // 'e-list-l1@example.com' (learner1) lands before 'e-list-l2@...'.
    expect(rows[0].learnerId).toBe(learner1)
    expect(rows[0].learnerEmail).toBe('e-list-l1@example.com')
    expect(rows[0].displayName).toBe('Анна Иванова')
    expect(rows[0].isAssigned).toBe(true)
    expect(rows[1].learnerId).toBe(learner2)
    expect(rows[1].learnerEmail).toBe('e-list-l2@example.com')
    expect(rows[1].displayName).toBe('Борис Петров')
    expect(rows[1].isAssigned).toBe(true)
  })

  it('anti-spoof (a): teacher A does NOT see teacher B linked learners', async () => {
    const teacherA = await makeTeacher('e-list-ta-spoof@example.com')
    const teacherB = await makeTeacher('e-list-tb-spoof@example.com')
    // Teacher B has one learner; teacher A has zero.
    const learnerOfB = await makeLearner('e-list-only-b@example.com')
    await linkLearnerToTeacher(learnerOfB, teacherB)

    const rowsForA = await listLearnersForTeacher(teacherA)
    expect(rowsForA).toHaveLength(0)
    // Sanity: teacher B's view does include the learner.
    const rowsForB = await listLearnersForTeacher(teacherB)
    expect(rowsForB.map((r) => r.learnerId)).toContain(learnerOfB)
  })
})

describe('Sub-PR E — drill-down anti-spoof at /teacher/learners/[id]', () => {
  it('(b) GET /teacher/learners/<learnerOfTeacherB> as teacher A → 404 (no info leak)', async () => {
    const teacherA = await makeTeacher('e-spoof-ta@example.com')
    const teacherB = await makeTeacher('e-spoof-tb@example.com')
    const learnerOfB = await makeLearner('e-spoof-victim@example.com')
    await linkLearnerToTeacher(learnerOfB, teacherB)

    mockCookieValue = await teacherSessionCookieValue(teacherA)

    // Lazy-load so the next/headers + next/navigation mocks above
    // bind into the imported module graph BEFORE the page imports.
    const mod = await import('@/app/teacher/learners/[id]/page')
    const Page = mod.default

    let caught: unknown = null
    try {
      await Page({ params: Promise.resolve({ id: learnerOfB }) })
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(NextNotFoundError)
    expect((caught as NextNotFoundError).digest).toBe('NEXT_NOT_FOUND')
  })

  it('(c) GET /teacher/learners/<adminAccountId> as teacher → 404 (non-learner target rejected)', async () => {
    const teacher = await makeTeacher('e-spoof-tc-teacher@example.com')
    const adminId = await makeAdmin('e-spoof-tc-admin@example.com')

    // No `learner_teacher_links` row + no `lesson_slots` row pinning
    // (teacher, adminId) — the drill-down's guard EXISTS subquery
    // returns false → notFound(). This is the archetype-rejection
    // shape Q-12 calls out: a non-learner UUID that isn't in the
    // teacher's roster.
    mockCookieValue = await teacherSessionCookieValue(teacher)

    const mod = await import('@/app/teacher/learners/[id]/page')
    const Page = mod.default

    let caught: unknown = null
    try {
      await Page({ params: Promise.resolve({ id: adminId }) })
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(NextNotFoundError)
    expect((caught as NextNotFoundError).digest).toBe('NEXT_NOT_FOUND')

    // Bonus pin: even if a misconfigured raw-SQL link existed for the
    // admin target, the drill-down's helper invocation would not let
    // the actor mutate it (the rename route's archetype gate is
    // separate). Here we ONLY assert the GET-by-uuid 404.
    // The DB-side guarantee: no row was added.
    const linkRow = await getDbPool().query(
      `select 1 from learner_teacher_links
        where learner_account_id = $1::uuid
          and teacher_account_id = $2::uuid`,
      [adminId, teacher],
    )
    expect(linkRow.rows.length).toBe(0)
  })
})
