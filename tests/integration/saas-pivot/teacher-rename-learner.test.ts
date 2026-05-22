import { describe, expect, it } from 'vitest'

import { POST as renamePost } from '@/app/api/teacher/learners/[id]/rename/route'
import { grantAccountRole } from '@/lib/auth/accounts'
import { getAuthPool } from '@/lib/auth/pool'
import {
  SESSION_COOKIE_NAME,
  createSession,
} from '@/lib/auth/sessions'

import '../setup'
import { buildRequest } from '../helpers'

// SAAS-PIVOT — teacher rename learner integration coverage.
//
// Plan: owner-requested 2026-05-23.
//
// Pins:
//   1. Happy path: teacher renames their linked learner's name + email.
//   2. Anti-spoof: teacher A cannot rename teacher B's learner (404).
//   3. Email collision: rename to an existing email → 409 (no DB change).
//   4. Display name only (no email): works.
//   5. Email only (no display name): works.
//   6. Non-learner target (admin/teacher role): 422 wrong_archetype.
//   7. Rate-limit kicks in at 11th request/hour per teacher.

async function makeAccount(email: string): Promise<string> {
  const pool = getAuthPool()
  const r = await pool.query<{ id: string }>(
    `insert into accounts (email, password_hash, email_verified_at)
       values ($1, 'fake-hash-rename-tests', now())
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
  // Learner = account with no role, email verified.
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

async function teacherCookie(teacherId: string): Promise<string> {
  const { cookieValue } = await createSession({ accountId: teacherId })
  return `${SESSION_COOKIE_NAME}=${cookieValue}`
}

function callRename(
  learnerId: string,
  cookie: string,
  body: Record<string, unknown>,
) {
  return renamePost(
    buildRequest(`/api/teacher/learners/${learnerId}/rename`, {
      method: 'POST',
      cookie,
      body,
    }),
    { params: Promise.resolve({ id: learnerId }) },
  )
}

describe('SAAS-PIVOT — teacher rename learner: happy paths', () => {
  it('teacher renames their linked learner display_name + email together', async () => {
    const teacher = await makeTeacher('rn-teacher-a@example.com')
    const learner = await makeLearnerWithProfile(
      'rn-learner-old@example.com',
      'Старое Имя',
    )
    await linkLearnerToTeacher(learner, teacher)
    const cookie = await teacherCookie(teacher)

    const res = await callRename(learner, cookie, {
      displayName: 'Новое Имя',
      email: 'rn-learner-new@example.com',
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.updated.displayName).toBe('Новое Имя')
    expect(body.updated.email).toBe('rn-learner-new@example.com')

    // DB reflects the change.
    const accountRow = await getAuthPool().query<{ email: string }>(
      `select email from accounts where id = $1`,
      [learner],
    )
    expect(accountRow.rows[0].email).toBe('rn-learner-new@example.com')

    const profileRow = await getAuthPool().query<{ display_name: string }>(
      `select display_name from account_profiles where account_id = $1`,
      [learner],
    )
    expect(profileRow.rows[0].display_name).toBe('Новое Имя')
  })

  it('display_name only (no email): works and leaves email untouched', async () => {
    const teacher = await makeTeacher('rn-teacher-dn@example.com')
    const learner = await makeLearner('rn-learner-dn@example.com')
    await linkLearnerToTeacher(learner, teacher)
    const cookie = await teacherCookie(teacher)

    const res = await callRename(learner, cookie, { displayName: 'Petya' })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.updated.displayName).toBe('Petya')
    expect(body.updated.email).toBeUndefined()

    const row = await getAuthPool().query<{
      email: string
      display_name: string
    }>(
      `select a.email, p.display_name
         from accounts a
         left join account_profiles p on p.account_id = a.id
        where a.id = $1`,
      [learner],
    )
    expect(row.rows[0].email).toBe('rn-learner-dn@example.com')
    expect(row.rows[0].display_name).toBe('Petya')
  })

  it('email only (no display_name): works and leaves display_name untouched', async () => {
    const teacher = await makeTeacher('rn-teacher-em@example.com')
    const learner = await makeLearnerWithProfile(
      'rn-learner-em-old@example.com',
      'Vasya',
    )
    await linkLearnerToTeacher(learner, teacher)
    const cookie = await teacherCookie(teacher)

    const res = await callRename(learner, cookie, {
      email: 'rn-learner-em-new@example.com',
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.updated.email).toBe('rn-learner-em-new@example.com')
    expect(body.updated.displayName).toBeUndefined()

    const row = await getAuthPool().query<{
      email: string
      display_name: string
    }>(
      `select a.email, p.display_name
         from accounts a
         left join account_profiles p on p.account_id = a.id
        where a.id = $1`,
      [learner],
    )
    expect(row.rows[0].email).toBe('rn-learner-em-new@example.com')
    expect(row.rows[0].display_name).toBe('Vasya')
  })

  it('email normalisation: trims + lowercases input', async () => {
    const teacher = await makeTeacher('rn-teacher-norm@example.com')
    const learner = await makeLearner('rn-learner-norm@example.com')
    await linkLearnerToTeacher(learner, teacher)
    const cookie = await teacherCookie(teacher)

    const res = await callRename(learner, cookie, {
      email: '  MIXED-Case@Example.COM  ',
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.updated.email).toBe('mixed-case@example.com')
  })
})

describe('SAAS-PIVOT — teacher rename learner: anti-spoof', () => {
  it('teacher A cannot rename teacher B linked learner (404)', async () => {
    const teacherA = await makeTeacher('rn-ta-spoof@example.com')
    const teacherB = await makeTeacher('rn-tb-spoof@example.com')
    const learner = await makeLearner('rn-spoof-learner@example.com')
    await linkLearnerToTeacher(learner, teacherB) // linked to B only
    const cookieA = await teacherCookie(teacherA)

    const res = await callRename(learner, cookieA, {
      displayName: 'Hacker',
    })
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe('not_found')

    // DB untouched.
    const row = await getAuthPool().query<{
      email: string
      display_name: string | null
    }>(
      `select a.email, p.display_name
         from accounts a
         left join account_profiles p on p.account_id = a.id
        where a.id = $1`,
      [learner],
    )
    expect(row.rows[0].email).toBe('rn-spoof-learner@example.com')
    expect(row.rows[0].display_name).toBeNull()
  })

  it('historical (unlinked) link does NOT grant rename permission (404)', async () => {
    const teacher = await makeTeacher('rn-unlinked-teacher@example.com')
    const learner = await makeLearner('rn-unlinked-learner@example.com')
    await linkLearnerToTeacher(learner, teacher)
    // Now soft-unlink.
    await getAuthPool().query(
      `update learner_teacher_links
          set unlinked_at = now()
        where learner_account_id = $1 and teacher_account_id = $2`,
      [learner, teacher],
    )
    const cookie = await teacherCookie(teacher)

    const res = await callRename(learner, cookie, {
      displayName: 'Should not work',
    })
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe('not_found')
  })

  it('non-learner target (teacher role) → 422 wrong_archetype', async () => {
    const teacherA = await makeTeacher('rn-actor-teacher@example.com')
    const teacherB = await makeTeacher('rn-target-teacher@example.com')
    // Force a (broken) link from teacher A to teacher B. Normally
    // setAssignedTeacher would refuse this, but a misconfigured admin
    // could drop a raw row. Helper must refuse the rename regardless.
    await getAuthPool().query(
      `insert into learner_teacher_links (learner_account_id, teacher_account_id, linked_at)
         values ($1, $2, now())
       on conflict do nothing`,
      [teacherB, teacherA],
    )
    const cookie = await teacherCookie(teacherA)

    const res = await callRename(teacherB, cookie, {
      displayName: 'Cross-tenant attack',
    })
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.error).toBe('wrong_archetype')
  })

  it('non-learner target (admin role) → 422 wrong_archetype', async () => {
    const teacher = await makeTeacher('rn-actor-vs-admin@example.com')
    // Admin "target": granting admin role first, then forcing a link.
    const adminId = await makeAccount('rn-admin-target@example.com')
    await grantAccountRole(adminId, 'admin', null)
    await getAuthPool().query(
      `insert into learner_teacher_links (learner_account_id, teacher_account_id, linked_at)
         values ($1, $2, now())
       on conflict do nothing`,
      [adminId, teacher],
    )
    const cookie = await teacherCookie(teacher)

    const res = await callRename(adminId, cookie, {
      displayName: 'Should fail',
    })
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.error).toBe('wrong_archetype')
  })
})

describe('SAAS-PIVOT — teacher rename learner: validation', () => {
  it('email collision → 409 email_in_use, no DB change', async () => {
    const teacher = await makeTeacher('rn-collide-teacher@example.com')
    const otherLearner = await makeLearner('rn-collide-other@example.com')
    void otherLearner
    const learner = await makeLearnerWithProfile(
      'rn-collide-target@example.com',
      'Original',
    )
    await linkLearnerToTeacher(learner, teacher)
    const cookie = await teacherCookie(teacher)

    const res = await callRename(learner, cookie, {
      displayName: 'NewName',
      email: 'rn-collide-other@example.com', // already used by otherLearner
    })
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toBe('email_in_use')

    // CRITICAL: the rename is atomic — no field changed.
    const row = await getAuthPool().query<{
      email: string
      display_name: string | null
    }>(
      `select a.email, p.display_name
         from accounts a
         left join account_profiles p on p.account_id = a.id
        where a.id = $1`,
      [learner],
    )
    expect(row.rows[0].email).toBe('rn-collide-target@example.com')
    expect(row.rows[0].display_name).toBe('Original')
  })

  it('empty body → 400 noop', async () => {
    const teacher = await makeTeacher('rn-empty-teacher@example.com')
    const learner = await makeLearner('rn-empty-learner@example.com')
    await linkLearnerToTeacher(learner, teacher)
    const cookie = await teacherCookie(teacher)

    const res = await callRename(learner, cookie, {})
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('noop')
  })

  it('blank displayName → 400 displayName_empty', async () => {
    const teacher = await makeTeacher('rn-blank-teacher@example.com')
    const learner = await makeLearner('rn-blank-learner@example.com')
    await linkLearnerToTeacher(learner, teacher)
    const cookie = await teacherCookie(teacher)

    const res = await callRename(learner, cookie, { displayName: '   ' })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('displayName_empty')
  })

  it('malformed email → 400 email_invalid', async () => {
    const teacher = await makeTeacher('rn-malf-teacher@example.com')
    const learner = await makeLearner('rn-malf-learner@example.com')
    await linkLearnerToTeacher(learner, teacher)
    const cookie = await teacherCookie(teacher)

    const res = await callRename(learner, cookie, { email: 'not-an-email' })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('email_invalid')
  })

  it('overlong displayName (>60) → 400 displayName_too_long', async () => {
    const teacher = await makeTeacher('rn-long-teacher@example.com')
    const learner = await makeLearner('rn-long-learner@example.com')
    await linkLearnerToTeacher(learner, teacher)
    const cookie = await teacherCookie(teacher)

    const res = await callRename(learner, cookie, {
      displayName: 'x'.repeat(61),
    })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('displayName_too_long')
  })

  it('non-string displayName → 400 displayName_invalid', async () => {
    const teacher = await makeTeacher('rn-typed-teacher@example.com')
    const learner = await makeLearner('rn-typed-learner@example.com')
    await linkLearnerToTeacher(learner, teacher)
    const cookie = await teacherCookie(teacher)

    const res = await callRename(learner, cookie, { displayName: 123 })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('displayName_invalid')
  })

  it('shape-invalid learner id → 404 (no info leak)', async () => {
    const teacher = await makeTeacher('rn-shape-teacher@example.com')
    const cookie = await teacherCookie(teacher)

    const res = await callRename('not-a-uuid', cookie, {
      displayName: 'X',
    })
    expect(res.status).toBe(404)
  })
})

describe('SAAS-PIVOT — teacher rename learner: rate-limit', () => {
  it('rate-limit kicks in at the 11th request in an hour per teacher', async () => {
    const teacher = await makeTeacher('rn-rl-teacher@example.com')
    const learner = await makeLearnerWithProfile(
      'rn-rl-learner@example.com',
      'Init',
    )
    await linkLearnerToTeacher(learner, teacher)
    const cookie = await teacherCookie(teacher)

    // First 10 calls go through. We rotate `displayName` so each call
    // mutates state but stays valid.
    for (let i = 0; i < 10; i += 1) {
      const res = await callRename(learner, cookie, {
        displayName: `Name-${i}`,
      })
      expect(res.status, `request ${i} should succeed`).toBe(200)
    }
    // 11th call should be 429.
    const blocked = await callRename(learner, cookie, {
      displayName: 'OneTooMany',
    })
    expect(blocked.status).toBe(429)
  })
})

describe('SAAS-PIVOT — teacher rename learner: auth gates', () => {
  it('no session → 401', async () => {
    const teacher = await makeTeacher('rn-noauth-teacher@example.com')
    const learner = await makeLearner('rn-noauth-learner@example.com')
    await linkLearnerToTeacher(learner, teacher)

    const res = await renamePost(
      buildRequest(`/api/teacher/learners/${learner}/rename`, {
        method: 'POST',
        body: { displayName: 'X' },
        // no cookie
      }),
      { params: Promise.resolve({ id: learner }) },
    )
    expect(res.status).toBe(401)
  })

  it('learner role hitting teacher route → 403', async () => {
    const teacher = await makeTeacher('rn-rolegate-teacher@example.com')
    const learner = await makeLearner('rn-rolegate-learner@example.com')
    await linkLearnerToTeacher(learner, teacher)

    // Session bound to the LEARNER, not the teacher — should be refused
    // by requireTeacherAndVerified (wrong_role).
    const learnerSession = await createSession({ accountId: learner })
    const cookie = `${SESSION_COOKIE_NAME}=${learnerSession.cookieValue}`

    const res = await renamePost(
      buildRequest(`/api/teacher/learners/${learner}/rename`, {
        method: 'POST',
        body: { displayName: 'Self-rename' },
        cookie,
      }),
      { params: Promise.resolve({ id: learner }) },
    )
    expect(res.status).toBe(403)
  })
})
