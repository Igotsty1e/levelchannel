import { describe, expect, it } from 'vitest'

import { listActivePackages, listActivePackagesByDuration } from '@/lib/billing/packages'
import { getDbPool } from '@/lib/db/pool'

import '../setup'

// Bug #2 regression — packages must be scoped to learner's teacher(s).
//
// Plan: docs/plans/bug-2-packages-scoped-to-teacher.md.
// Fix: lib/billing/packages/catalog.ts `listActivePackages` joins
// `learner_teacher_links` (active) for authenticated viewers so a fresh
// learner sees ZERO packages, and a linked learner sees ONLY their
// teacher's packages.

type SeededTeacher = {
  teacherId: string
  catalogPackageId: string
  privatePackageId: string
}

async function seedTeacherWithPackages(prefix: string): Promise<SeededTeacher> {
  const pool = getDbPool()
  const tRes = await pool.query<{ id: string }>(
    `insert into accounts (email, password_hash, email_verified_at)
     values ($1, 'dummy', now()) returning id`,
    [
      `${prefix}-t-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`,
    ],
  )
  const teacherId = String(tRes.rows[0].id)
  await pool.query(
    `insert into account_roles (account_id, role) values ($1, 'teacher')`,
    [teacherId],
  )
  await pool.query(
    `insert into teacher_subscriptions (account_id, plan_slug, state)
     values ($1, 'operator-managed', 'active')
     on conflict (account_id) do update
       set plan_slug = excluded.plan_slug, state = excluded.state`,
    [teacherId],
  )
  const mkPkg = async (
    visibility: 'catalog' | 'private',
  ): Promise<string> => {
    const r = await pool.query<{ id: string }>(
      `insert into lesson_packages
         (slug, title_ru, duration_minutes, count, amount_kopecks,
          is_active, display_order, teacher_id, visibility)
       values ($1, $2, 60, 5, 10000, true, 100, $3, $4)
       returning id`,
      [
        `${prefix}-${visibility}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
        `${prefix} ${visibility}`,
        teacherId,
        visibility,
      ],
    )
    return String(r.rows[0].id)
  }
  const catalogPackageId = await mkPkg('catalog')
  const privatePackageId = await mkPkg('private')
  return { teacherId, catalogPackageId, privatePackageId }
}

async function seedLearner(prefix: string): Promise<string> {
  const pool = getDbPool()
  const r = await pool.query<{ id: string }>(
    `insert into accounts (email, password_hash, email_verified_at)
     values ($1, 'dummy', now()) returning id`,
    [
      `${prefix}-l-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`,
    ],
  )
  return String(r.rows[0].id)
}

async function linkLearnerToTeacher(
  learnerId: string,
  teacherId: string,
): Promise<void> {
  const pool = getDbPool()
  await pool.query(
    `insert into learner_teacher_links (teacher_account_id, learner_account_id)
     values ($1, $2)
     on conflict (learner_account_id, teacher_account_id)
       do update set unlinked_at = null`,
    [teacherId, learnerId],
  )
}

async function unlinkLearner(
  learnerId: string,
  teacherId: string,
): Promise<void> {
  const pool = getDbPool()
  await pool.query(
    `update learner_teacher_links
        set unlinked_at = now()
      where learner_account_id = $1
        and teacher_account_id = $2`,
    [learnerId, teacherId],
  )
}

async function grantPrivatePackage(
  learnerId: string,
  teacherId: string,
  packageId: string,
): Promise<void> {
  const pool = getDbPool()
  await pool.query(
    `insert into learner_package_access (teacher_id, learner_account_id, package_id)
     values ($1, $2, $3)`,
    [teacherId, learnerId, packageId],
  )
}

describe('Bug #2 — learner package catalog scoped to teacher links', () => {
  it('fresh learner (zero links) sees ZERO packages', async () => {
    const teacherA = await seedTeacherWithPackages('bug2-fresh-a')
    const teacherB = await seedTeacherWithPackages('bug2-fresh-b')
    const learnerId = await seedLearner('bug2-fresh')

    const result = await listActivePackages(learnerId)
    const ids = new Set(result.map((p) => p.id))

    expect(ids.has(teacherA.catalogPackageId)).toBe(false)
    expect(ids.has(teacherB.catalogPackageId)).toBe(false)
    expect(ids.has(teacherA.privatePackageId)).toBe(false)
    expect(ids.has(teacherB.privatePackageId)).toBe(false)
  })

  it('learner linked to teacher A sees A catalog only (not A private, not any B)', async () => {
    const teacherA = await seedTeacherWithPackages('bug2-linka-a')
    const teacherB = await seedTeacherWithPackages('bug2-linka-b')
    const learnerId = await seedLearner('bug2-linka')
    await linkLearnerToTeacher(learnerId, teacherA.teacherId)

    const result = await listActivePackages(learnerId)
    const ids = new Set(result.map((p) => p.id))

    expect(ids.has(teacherA.catalogPackageId)).toBe(true)
    expect(ids.has(teacherA.privatePackageId)).toBe(false)
    expect(ids.has(teacherB.catalogPackageId)).toBe(false)
    expect(ids.has(teacherB.privatePackageId)).toBe(false)
  })

  it('learner linked to A + private grant on A sees A catalog + A private', async () => {
    const teacherA = await seedTeacherWithPackages('bug2-granta-a')
    const teacherB = await seedTeacherWithPackages('bug2-granta-b')
    const learnerId = await seedLearner('bug2-granta')
    await linkLearnerToTeacher(learnerId, teacherA.teacherId)
    await grantPrivatePackage(
      learnerId,
      teacherA.teacherId,
      teacherA.privatePackageId,
    )

    const result = await listActivePackages(learnerId)
    const ids = new Set(result.map((p) => p.id))

    expect(ids.has(teacherA.catalogPackageId)).toBe(true)
    expect(ids.has(teacherA.privatePackageId)).toBe(true)
    expect(ids.has(teacherB.catalogPackageId)).toBe(false)
    expect(ids.has(teacherB.privatePackageId)).toBe(false)
  })

  it('learner linked to A then unlinked sees ZERO packages (defense in depth for stale grants)', async () => {
    const teacherA = await seedTeacherWithPackages('bug2-unlink-a')
    const learnerId = await seedLearner('bug2-unlink')
    await linkLearnerToTeacher(learnerId, teacherA.teacherId)
    await grantPrivatePackage(
      learnerId,
      teacherA.teacherId,
      teacherA.privatePackageId,
    )
    await unlinkLearner(learnerId, teacherA.teacherId)

    const result = await listActivePackages(learnerId)
    const ids = new Set(result.map((p) => p.id))

    expect(ids.has(teacherA.catalogPackageId)).toBe(false)
    expect(ids.has(teacherA.privatePackageId)).toBe(false)
  })

  it('learner linked to both A and B sees union of A + B catalogs', async () => {
    const teacherA = await seedTeacherWithPackages('bug2-multi-a')
    const teacherB = await seedTeacherWithPackages('bug2-multi-b')
    const learnerId = await seedLearner('bug2-multi')
    await linkLearnerToTeacher(learnerId, teacherA.teacherId)
    await linkLearnerToTeacher(learnerId, teacherB.teacherId)

    const result = await listActivePackages(learnerId)
    const ids = new Set(result.map((p) => p.id))

    expect(ids.has(teacherA.catalogPackageId)).toBe(true)
    expect(ids.has(teacherB.catalogPackageId)).toBe(true)
    expect(ids.has(teacherA.privatePackageId)).toBe(false)
    expect(ids.has(teacherB.privatePackageId)).toBe(false)
  })

  it('anonymous viewer (no id) sees catalog from every operator-managed teacher (legacy contract)', async () => {
    const teacherA = await seedTeacherWithPackages('bug2-anon-a')
    const teacherB = await seedTeacherWithPackages('bug2-anon-b')

    const result = await listActivePackages()
    const ids = new Set(result.map((p) => p.id))

    expect(ids.has(teacherA.catalogPackageId)).toBe(true)
    expect(ids.has(teacherB.catalogPackageId)).toBe(true)
    expect(ids.has(teacherA.privatePackageId)).toBe(false)
    expect(ids.has(teacherB.privatePackageId)).toBe(false)
  })

  it('listActivePackagesByDuration with teacher scope still filters cross-teacher correctly', async () => {
    const teacherA = await seedTeacherWithPackages('bug2-byd-a')
    const teacherB = await seedTeacherWithPackages('bug2-byd-b')

    // Booking-hint surface: caller passes teacher scope so we only
    // see A's package even with no viewer scope.
    const result = await listActivePackagesByDuration(60, 10, {
      teacherAccountId: teacherA.teacherId,
      viewerAccountId: null,
    })
    const ids = new Set(result.map((p) => p.id))

    expect(ids.has(teacherA.catalogPackageId)).toBe(true)
    expect(ids.has(teacherB.catalogPackageId)).toBe(false)
  })
})
