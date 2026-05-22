import { describe, expect, it, vi } from 'vitest'

import { POST as unlinkHandler } from '@/app/api/cabinet/links/[teacherId]/unlink/route'
import { grantAccountRole } from '@/lib/auth/accounts'
import { getAuthPool } from '@/lib/auth/pool'
import {
  SESSION_COOKIE_NAME,
  createSession,
} from '@/lib/auth/sessions'
import {
  getActiveTeacherIdsForLearner,
} from '@/lib/auth/teacher-scope'
import { loadTeacherBlocks } from '@/lib/cabinet/teacher-blocks'

import '../setup'
import { buildRequest } from '../helpers'

// SAAS-PIVOT Epic 7 Day 7 — cabinet n:m polish + self-unlink contract.
//
// Pins the load-bearing claims for the multi-teacher cabinet surface:
//   - loadTeacherBlocks returns one block per active link.
//   - POST /api/cabinet/links/[teacherId]/unlink soft-sets unlinked_at.
//   - Subsequent getActiveTeacherIdsForLearner drops the teacher.
//   - Anti-spoof: another learner cannot unlink THIS learner's link.
//   - Wrong-teacher / wrong-UUID collapses to 404.
//   - Re-link path (operator re-arms) brings the teacher back into the
//     active set without losing history.

vi.mock('@/lib/email/dispatch', () => ({
  sendVerifyEmail: vi.fn().mockResolvedValue({ ok: true }),
  sendAlreadyRegisteredEmail: vi.fn().mockResolvedValue({ ok: true }),
  sendPasswordResetEmail: vi.fn().mockResolvedValue({ ok: true }),
}))

async function makeAccount(email: string): Promise<string> {
  const pool = getAuthPool()
  const r = await pool.query<{ id: string }>(
    `insert into accounts (email, password_hash, email_verified_at)
       values ($1, 'fake-hash-cabinet-nm-test', now())
     returning id`,
    [email],
  )
  return r.rows[0].id
}

async function makeTeacher(
  email: string,
  displayName: string | null = null,
): Promise<string> {
  const id = await makeAccount(email)
  await grantAccountRole(id, 'teacher', null)
  if (displayName) {
    await getAuthPool().query(
      `insert into account_profiles (account_id, display_name)
         values ($1, $2)
       on conflict (account_id) do update set display_name = excluded.display_name`,
      [id, displayName],
    )
  }
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

async function learnerCookie(learnerId: string): Promise<string> {
  const session = await createSession({ accountId: learnerId })
  return `${SESSION_COOKIE_NAME}=${session.cookieValue}`
}

describe('SAAS-PIVOT Epic 7 Day 7 — loadTeacherBlocks', () => {
  it('returns empty array for a learner with zero active links', async () => {
    const learner = await makeAccount('zero-blocks-learner@example.com')
    const blocks = await loadTeacherBlocks(learner, [])
    expect(blocks).toEqual([])
  })

  it('returns one block per teacher in the order given (linked_at asc preserved)', async () => {
    const tA = await makeTeacher('blocks-a@example.com', 'Анна А.')
    const tB = await makeTeacher('blocks-b@example.com', 'Борис Б.')
    const learner = await makeAccount('blocks-multi@example.com')
    await link(learner, tA, `now() - interval '2 hours'`)
    await link(learner, tB, `now() - interval '1 hour'`)

    const ids = await getActiveTeacherIdsForLearner(learner)
    expect(ids).toEqual([tA, tB])

    const blocks = await loadTeacherBlocks(learner, ids)
    expect(blocks).toHaveLength(2)
    expect(blocks[0]?.teacherId).toBe(tA)
    expect(blocks[0]?.teacherDisplayName).toBe('Анна А.')
    expect(blocks[1]?.teacherId).toBe(tB)
    expect(blocks[1]?.teacherDisplayName).toBe('Борис Б.')
    // No slots / no debt / no packages by default.
    for (const b of blocks) {
      expect(b.upcomingSlots).toEqual([])
      expect(b.balanceOwedKopecks).toBe(0)
      expect(b.debtSlotCount).toBe(0)
      expect(b.activePackageCount).toBe(0)
    }
  })

  it('falls back to email when display_name is absent', async () => {
    const teacherEmail = 'no-display@example.com'
    const teacher = await makeTeacher(teacherEmail) // no profile row
    const learner = await makeAccount('no-display-learner@example.com')
    await link(learner, teacher)

    const blocks = await loadTeacherBlocks(learner, [teacher])
    expect(blocks).toHaveLength(1)
    expect(blocks[0]?.teacherDisplayName).toBe(teacherEmail)
  })
})

describe('SAAS-PIVOT Epic 7 Day 7 — POST /api/cabinet/links/[teacherId]/unlink', () => {
  it('soft-sets unlinked_at for an active link owned by the session learner', async () => {
    const teacher = await makeTeacher('unlink-soft@example.com')
    const learner = await makeAccount('unlink-soft-learner@example.com')
    await link(learner, teacher)

    const cookie = await learnerCookie(learner)
    const res = await unlinkHandler(
      buildRequest(`/api/cabinet/links/${teacher}/unlink`, {
        method: 'POST',
        cookie,
      }),
      { params: Promise.resolve({ teacherId: teacher }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)

    // Soft-unlink: row stays, unlinked_at populated.
    const row = await getAuthPool().query<{ unlinked_at: string | null }>(
      `select unlinked_at from learner_teacher_links
        where learner_account_id = $1 and teacher_account_id = $2`,
      [learner, teacher],
    )
    expect(row.rows).toHaveLength(1)
    expect(row.rows[0]?.unlinked_at).not.toBeNull()
  })

  it('subsequent getActiveTeacherIdsForLearner excludes the unlinked teacher', async () => {
    const tKeep = await makeTeacher('unlink-keep@example.com')
    const tDrop = await makeTeacher('unlink-drop@example.com')
    const learner = await makeAccount('unlink-set-learner@example.com')
    await link(learner, tKeep, `now() - interval '2 hours'`)
    await link(learner, tDrop, `now() - interval '1 hour'`)

    const cookie = await learnerCookie(learner)
    const res = await unlinkHandler(
      buildRequest(`/api/cabinet/links/${tDrop}/unlink`, {
        method: 'POST',
        cookie,
      }),
      { params: Promise.resolve({ teacherId: tDrop }) },
    )
    expect(res.status).toBe(200)

    const idsAfter = await getActiveTeacherIdsForLearner(learner)
    expect(idsAfter).toEqual([tKeep])
  })

  it('anti-spoof: a different learner cannot unlink someone else\'s link (404)', async () => {
    const teacher = await makeTeacher('antispoof-teacher@example.com')
    const owner = await makeAccount('antispoof-owner@example.com')
    const intruder = await makeAccount('antispoof-intruder@example.com')
    await link(owner, teacher)

    const cookie = await learnerCookie(intruder)
    const res = await unlinkHandler(
      buildRequest(`/api/cabinet/links/${teacher}/unlink`, {
        method: 'POST',
        cookie,
      }),
      { params: Promise.resolve({ teacherId: teacher }) },
    )
    expect(res.status).toBe(404)

    // Owner's link untouched.
    const row = await getAuthPool().query<{ unlinked_at: string | null }>(
      `select unlinked_at from learner_teacher_links
        where learner_account_id = $1 and teacher_account_id = $2`,
      [owner, teacher],
    )
    expect(row.rows[0]?.unlinked_at).toBeNull()
  })

  it('returns 404 for non-UUID teacherId without DB hit', async () => {
    const learner = await makeAccount('bad-uuid-learner@example.com')
    const cookie = await learnerCookie(learner)
    const res = await unlinkHandler(
      buildRequest(`/api/cabinet/links/not-a-uuid/unlink`, {
        method: 'POST',
        cookie,
      }),
      { params: Promise.resolve({ teacherId: 'not-a-uuid' }) },
    )
    expect(res.status).toBe(404)
  })

  it('returns 404 when no active link exists (already unlinked)', async () => {
    const teacher = await makeTeacher('already-unlinked-teacher@example.com')
    const learner = await makeAccount('already-unlinked-learner@example.com')
    await link(learner, teacher)
    // Pre-set unlinked_at to simulate a prior unlink.
    await getAuthPool().query(
      `update learner_teacher_links
          set unlinked_at = now()
        where learner_account_id = $1 and teacher_account_id = $2`,
      [learner, teacher],
    )

    const cookie = await learnerCookie(learner)
    const res = await unlinkHandler(
      buildRequest(`/api/cabinet/links/${teacher}/unlink`, {
        method: 'POST',
        cookie,
      }),
      { params: Promise.resolve({ teacherId: teacher }) },
    )
    expect(res.status).toBe(404)
  })

  it('returns 401 when the request carries no session cookie', async () => {
    const teacher = await makeTeacher('anon-teacher@example.com')
    const res = await unlinkHandler(
      buildRequest(`/api/cabinet/links/${teacher}/unlink`, {
        method: 'POST',
      }),
      { params: Promise.resolve({ teacherId: teacher }) },
    )
    expect(res.status).toBe(401)
  })

  it('rejects an elevated role (teacher trying to unlink as a learner)', async () => {
    // A teacher account attempts the learner-archetype-gated route.
    const teacherAttempting = await makeTeacher('teacher-as-learner@example.com')
    const otherTeacher = await makeTeacher('other-teacher@example.com')
    // Even if a row existed, the gate rejects pre-DB.
    await link(teacherAttempting, otherTeacher)

    const cookie = await learnerCookie(teacherAttempting)
    const res = await unlinkHandler(
      buildRequest(`/api/cabinet/links/${otherTeacher}/unlink`, {
        method: 'POST',
        cookie,
      }),
      { params: Promise.resolve({ teacherId: otherTeacher }) },
    )
    expect(res.status).toBe(403)
  })

  it('re-link path: operator reassign re-arms unlinked_at to null (history preserved)', async () => {
    const teacher = await makeTeacher('relink-teacher@example.com')
    const learner = await makeAccount('relink-learner@example.com')
    await link(learner, teacher)

    // First unlink.
    const cookie = await learnerCookie(learner)
    const res1 = await unlinkHandler(
      buildRequest(`/api/cabinet/links/${teacher}/unlink`, {
        method: 'POST',
        cookie,
      }),
      { params: Promise.resolve({ teacherId: teacher }) },
    )
    expect(res1.status).toBe(200)

    // Operator re-links via the same INSERT-or-revive shape used in
    // setAssignedTeacher / invite-redeem. The PK on (learner, teacher)
    // re-arms `unlinked_at` to null without losing the original row.
    await link(learner, teacher)
    const ids = await getActiveTeacherIdsForLearner(learner)
    expect(ids).toEqual([teacher])
  })
})
