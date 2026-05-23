// TASK-5 (mig 0095) — teacher renames learner with firstName/lastName.
//
// Pins:
//   1. Teacher passes firstName+lastName → display_name recomputed.
//   2. Same TX (all 3 fields land together).
//   3. Anti-spoof intact (teacherId from session, not body).

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

async function makeAccount(email: string): Promise<string> {
  const pool = getAuthPool()
  const r = await pool.query<{ id: string }>(
    `insert into accounts (email, password_hash, email_verified_at)
       values ($1, 'fake-hash-tcp-tests', now())
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

describe('TASK-5 — teacher rename learner with firstName/lastName', () => {
  it('first + last together → display_name recomputed in same TX', async () => {
    const teacher = await makeTeacher('tcp-rn-t1@example.com')
    const learner = await makeAccount('tcp-rn-l1@example.com')
    await linkLearnerToTeacher(learner, teacher)
    const cookie = await teacherCookie(teacher)

    const res = await callRename(learner, cookie, {
      firstName: 'Иван',
      lastName: 'Петров',
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.updated.firstName).toBe('Иван')
    expect(body.updated.lastName).toBe('Петров')
    expect(body.updated.displayName).toBe('Иван Петров')

    const row = await getAuthPool().query<{
      first_name: string | null
      last_name: string | null
      display_name: string | null
    }>(
      `select first_name, last_name, display_name
         from account_profiles where account_id = $1`,
      [learner],
    )
    expect(row.rows[0].first_name).toBe('Иван')
    expect(row.rows[0].last_name).toBe('Петров')
    expect(row.rows[0].display_name).toBe('Иван Петров')
  })

  it('firstName only (lastName null) → display_name = "Анна"', async () => {
    const teacher = await makeTeacher('tcp-rn-t2@example.com')
    const learner = await makeAccount('tcp-rn-l2@example.com')
    await linkLearnerToTeacher(learner, teacher)
    const cookie = await teacherCookie(teacher)

    const res = await callRename(learner, cookie, {
      firstName: 'Анна',
      lastName: null,
    })
    expect(res.status).toBe(200)
    const row = await getAuthPool().query<{
      first_name: string | null
      last_name: string | null
      display_name: string | null
    }>(
      `select first_name, last_name, display_name
         from account_profiles where account_id = $1`,
      [learner],
    )
    expect(row.rows[0].first_name).toBe('Анна')
    expect(row.rows[0].last_name).toBeNull()
    expect(row.rows[0].display_name).toBe('Анна')
  })

  it('partial PATCH: change firstName, keep existing lastName', async () => {
    const teacher = await makeTeacher('tcp-rn-t3@example.com')
    const learner = await makeAccount('tcp-rn-l3@example.com')
    await linkLearnerToTeacher(learner, teacher)
    // Seed the profile with both fields.
    await getAuthPool().query(
      `insert into account_profiles (account_id, first_name, last_name, display_name)
         values ($1, 'Старое', 'Имя', 'Старое Имя')
       on conflict (account_id) do update
         set first_name = excluded.first_name,
             last_name = excluded.last_name,
             display_name = excluded.display_name`,
      [learner],
    )
    const cookie = await teacherCookie(teacher)
    // Only change firstName — lastName should be preserved from DB.
    const res = await callRename(learner, cookie, { firstName: 'Новое' })
    expect(res.status).toBe(200)
    const row = await getAuthPool().query<{
      first_name: string | null
      last_name: string | null
      display_name: string | null
    }>(
      `select first_name, last_name, display_name
         from account_profiles where account_id = $1`,
      [learner],
    )
    expect(row.rows[0].first_name).toBe('Новое')
    expect(row.rows[0].last_name).toBe('Имя')
    expect(row.rows[0].display_name).toBe('Новое Имя')
  })

  it('teacher A cannot rename teacher B linked learner using first/last (anti-spoof)', async () => {
    const teacherA = await makeTeacher('tcp-rn-ta@example.com')
    const teacherB = await makeTeacher('tcp-rn-tb@example.com')
    const learner = await makeAccount('tcp-rn-lspoof@example.com')
    await linkLearnerToTeacher(learner, teacherB) // linked to B only
    const cookieA = await teacherCookie(teacherA)

    const res = await callRename(learner, cookieA, {
      firstName: 'Hacker',
      lastName: 'Spoof',
    })
    expect(res.status).toBe(404)
    const row = await getAuthPool().query<{
      first_name: string | null
      last_name: string | null
    }>(
      `select first_name, last_name from account_profiles where account_id = $1`,
      [learner],
    )
    // No row was inserted (the rename failed before write).
    expect(row.rows.length).toBe(0)
  })

  it('legacy displayName-only rename still works (back-compat)', async () => {
    const teacher = await makeTeacher('tcp-rn-legacy@example.com')
    const learner = await makeAccount('tcp-rn-legacy-l@example.com')
    await linkLearnerToTeacher(learner, teacher)
    const cookie = await teacherCookie(teacher)

    const res = await callRename(learner, cookie, {
      displayName: 'Legacy Only',
    })
    expect(res.status).toBe(200)
    const row = await getAuthPool().query<{
      first_name: string | null
      last_name: string | null
      display_name: string | null
    }>(
      `select first_name, last_name, display_name
         from account_profiles where account_id = $1`,
      [learner],
    )
    expect(row.rows[0].display_name).toBe('Legacy Only')
    // first/last not touched
    expect(row.rows[0].first_name).toBeNull()
    expect(row.rows[0].last_name).toBeNull()
  })

  it('over-long firstName → 400 firstName_too_long', async () => {
    const teacher = await makeTeacher('tcp-rn-long-t@example.com')
    const learner = await makeAccount('tcp-rn-long-l@example.com')
    await linkLearnerToTeacher(learner, teacher)
    const cookie = await teacherCookie(teacher)

    const res = await callRename(learner, cookie, {
      firstName: 'А'.repeat(61),
    })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('firstName_too_long')
  })
})
