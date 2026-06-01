import { describe, expect, it } from 'vitest'

import { listActivePackages } from '@/lib/billing/packages'
import { getDbPool } from '@/lib/db/pool'

import '../setup'

// T3 Sub-PR E — learner-side `/cabinet/packages` catalog filter.

async function seedTeacherAndPackages(args: {
  prefix: string
  catalogCount: number
  privateCount: number
}) {
  const pool = getDbPool()
  // Teacher with operator-managed plan (required by listActivePackages).
  const tRes = await pool.query<{ id: string }>(
    `insert into accounts (email, password_hash, email_verified_at)
     values ($1, 'dummy', now()) returning id`,
    [`${args.prefix}-t-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`],
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
  const mkPkg = async (visibility: 'catalog' | 'private', n: number) => {
    const r = await pool.query<{ id: string }>(
      `insert into lesson_packages
         (slug, title_ru, duration_minutes, count, amount_kopecks,
          is_active, display_order, teacher_id, visibility)
       values ($1, $2, 60, 5, 10000, true, 100, $3, $4)
       returning id`,
      [
        `${args.prefix}-${visibility}-${n}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
        `${visibility} ${n}`,
        teacherId,
        visibility,
      ],
    )
    return String(r.rows[0].id)
  }
  const catalogIds: string[] = []
  const privateIds: string[] = []
  for (let i = 0; i < args.catalogCount; i++) catalogIds.push(await mkPkg('catalog', i))
  for (let i = 0; i < args.privateCount; i++) privateIds.push(await mkPkg('private', i))
  return { teacherId, catalogIds, privateIds }
}

describe('T3 Sub-PR E — listActivePackages visibility filter', () => {
  it('anonymous viewer (no id) sees ONLY catalog packages', async () => {
    const { catalogIds, privateIds } = await seedTeacherAndPackages({
      prefix: 'lpa-anon',
      catalogCount: 2,
      privateCount: 3,
    })
    const result = await listActivePackages()
    const ids = new Set(result.map((p) => p.id))
    for (const id of catalogIds) expect(ids.has(id)).toBe(true)
    for (const id of privateIds) expect(ids.has(id)).toBe(false)
  })

  it('learner with active access for a private package sees it', async () => {
    const { teacherId, catalogIds, privateIds } = await seedTeacherAndPackages({
      prefix: 'lpa-grant',
      catalogCount: 1,
      privateCount: 2,
    })
    const pool = getDbPool()
    const learnerRes = await pool.query<{ id: string }>(
      `insert into accounts (email, password_hash, email_verified_at)
       values ($1, 'dummy', now()) returning id`,
      [`lpa-grant-l-${Date.now()}@example.com`],
    )
    const learnerId = String(learnerRes.rows[0].id)
    await pool.query(
      `insert into learner_teacher_links (teacher_account_id, learner_account_id)
       values ($1, $2)`,
      [teacherId, learnerId],
    )
    // Grant access to the FIRST private package only.
    await pool.query(
      `insert into learner_package_access (teacher_id, learner_account_id, package_id)
       values ($1, $2, $3)`,
      [teacherId, learnerId, privateIds[0]],
    )
    const result = await listActivePackages(learnerId)
    const ids = new Set(result.map((p) => p.id))
    expect(ids.has(catalogIds[0])).toBe(true)
    expect(ids.has(privateIds[0])).toBe(true)
    // Second private package without grant stays hidden.
    expect(ids.has(privateIds[1])).toBe(false)
  })

  it('revoked access for a private package hides it again', async () => {
    const { teacherId, privateIds } = await seedTeacherAndPackages({
      prefix: 'lpa-revoke',
      catalogCount: 0,
      privateCount: 1,
    })
    const pool = getDbPool()
    const learnerRes = await pool.query<{ id: string }>(
      `insert into accounts (email, password_hash, email_verified_at)
       values ($1, 'dummy', now()) returning id`,
      [`lpa-revoke-l-${Date.now()}@example.com`],
    )
    const learnerId = String(learnerRes.rows[0].id)
    await pool.query(
      `insert into learner_teacher_links (teacher_account_id, learner_account_id)
       values ($1, $2)`,
      [teacherId, learnerId],
    )
    await pool.query(
      `insert into learner_package_access (teacher_id, learner_account_id, package_id, revoked_at)
       values ($1, $2, $3, now())`,
      [teacherId, learnerId, privateIds[0]],
    )
    const result = await listActivePackages(learnerId)
    const ids = new Set(result.map((p) => p.id))
    expect(ids.has(privateIds[0])).toBe(false)
  })
})
