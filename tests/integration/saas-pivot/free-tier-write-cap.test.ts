import { describe, expect, it } from 'vitest'

import { POST as teacherPackagesPost } from '@/app/api/teacher/packages/route'
import { PATCH as teacherPackagesPatch } from '@/app/api/teacher/packages/[id]/route'
import { POST as teacherTariffsPost } from '@/app/api/teacher/tariffs/route'
import { grantAccountRole } from '@/lib/auth/accounts'
import { getAuthPool } from '@/lib/auth/pool'
import {
  SESSION_COOKIE_NAME,
  createSession,
} from '@/lib/auth/sessions'
import { getDbPool } from '@/lib/db/pool'

import '../setup'
import { buildRequest } from '../helpers'

// Free-tier 1pkg+1tariff unlock — write-cap matrix.
//
// Plan: docs/plans/free-tier-1pkg-1tariff-unlock.md §4 Tests.
//
// Pins:
//   1. Free teacher creates pkg #1 → 201; pkg #2 → 422 tier_write_cap_reached.
//   2. Archive pkg #1 (toggle is_active=false) → can create new pkg → 201.
//   3. Free teacher creates tariff #1 → 201; tariff #2 → 422.
//   4. Soft-delete (deleted_at) tariff #1 → can create new tariff → 201.
//   5. Operator-managed teacher creates 3 packages → all 201 (Infinity cap).
//   6. Mid-tier teacher creates pkg → 422 plan_upgrade_required (cap=0).
//   7. No-subscription-row teacher creates pkg → 422 plan_upgrade_required.

async function makeTeacher(opts: {
  emailSuffix: string
  planSlug: string | null
}): Promise<{ id: string; cookie: string }> {
  const email = `free-cap-${opts.emailSuffix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`.toLowerCase()
  const pool = getAuthPool()
  const r = await pool.query<{ id: string }>(
    `insert into accounts (email, password_hash, email_verified_at)
       values ($1, 'fake-hash-free-cap-tests', now())
     returning id`,
    [email],
  )
  const id = r.rows[0].id
  await grantAccountRole(id, 'teacher', null)
  if (opts.planSlug !== null) {
    await pool.query(
      `insert into teacher_subscriptions (account_id, plan_slug, state)
         values ($1::uuid, $2, 'active')
         on conflict (account_id) do update
           set plan_slug = excluded.plan_slug, state = 'active'`,
      [id, opts.planSlug],
    )
  }
  const session = await createSession({ accountId: id })
  return { id, cookie: `${SESSION_COOKIE_NAME}=${session.cookieValue}` }
}

function pkgBody(slug: string, titleRu = `Pkg ${slug}`) {
  return {
    slug,
    titleRu,
    durationMinutes: 60,
    count: 10,
    amountKopecks: 100000,
  }
}

function tariffBody(titleRu: string) {
  return {
    titleRu,
    amountKopecks: 100000,
    durationMinutes: 60,
  }
}

describe('free-tier 1pkg+1tariff unlock — packages cap', () => {
  it('free teacher: pkg #1 → 201, pkg #2 → 422 tier_write_cap_reached', async () => {
    const t = await makeTeacher({
      emailSuffix: 'pkg-free-2x',
      planSlug: 'free',
    })

    const r1 = await teacherPackagesPost(
      buildRequest('/api/teacher/packages', {
        cookie: t.cookie,
        body: pkgBody(`free-cap-pkg1-${Date.now()}`),
      }),
    )
    expect(r1.status).toBe(201)

    const r2 = await teacherPackagesPost(
      buildRequest('/api/teacher/packages', {
        cookie: t.cookie,
        body: pkgBody(`free-cap-pkg2-${Date.now()}`),
      }),
    )
    expect(r2.status).toBe(422)
    const body = await r2.json()
    expect(body.error).toBe('tier_write_cap_reached')
    expect(body.cap).toBe(1)
    expect(body.current).toBe(1)
    expect(body.tier).toBe('free')
  })

  it('free teacher: archive pkg #1 (is_active=false), then can create pkg #2 → 201', async () => {
    const t = await makeTeacher({
      emailSuffix: 'pkg-free-archive',
      planSlug: 'free',
    })

    const slug1 = `free-archive-pkg1-${Date.now()}`
    const r1 = await teacherPackagesPost(
      buildRequest('/api/teacher/packages', {
        cookie: t.cookie,
        body: pkgBody(slug1),
      }),
    )
    expect(r1.status).toBe(201)
    const body1 = await r1.json()
    const pkgId1 = body1.package.id as string

    // Archive (toggle is_active=false) directly via SQL — exercising the
    // /api/teacher/packages/[id] PATCH would be the user-visible path, but
    // we want to keep this test focused on the cap-counter invariant.
    await getDbPool().query(
      `update lesson_packages set is_active = false where id = $1`,
      [pkgId1],
    )

    const r2 = await teacherPackagesPost(
      buildRequest('/api/teacher/packages', {
        cookie: t.cookie,
        body: pkgBody(`free-archive-pkg2-${Date.now()}`),
      }),
    )
    expect(r2.status).toBe(201)
  })

  it('operator-managed teacher: 3 sequential creates → all 201 (unlimited cap)', async () => {
    const t = await makeTeacher({
      emailSuffix: 'pkg-opmanaged-3x',
      planSlug: 'operator-managed',
    })

    for (let i = 0; i < 3; i += 1) {
      const r = await teacherPackagesPost(
        buildRequest('/api/teacher/packages', {
          cookie: t.cookie,
          body: pkgBody(`op-pkg-${i}-${Date.now()}`),
        }),
      )
      expect(r.status).toBe(201)
    }
  })

  it('mid-tier teacher: pkg create → 422 plan_upgrade_required (cap=0)', async () => {
    const t = await makeTeacher({
      emailSuffix: 'pkg-mid-blocked',
      planSlug: 'mid',
    })

    const r = await teacherPackagesPost(
      buildRequest('/api/teacher/packages', {
        cookie: t.cookie,
        body: pkgBody(`mid-pkg-${Date.now()}`),
      }),
    )
    expect(r.status).toBe(422)
    const body = await r.json()
    expect(body.error).toBe('plan_upgrade_required')
  })

  it('legacy no-row defensive state: pkg create → 422 plan_upgrade_required (cap=0 fallback)', async () => {
    const t = await makeTeacher({
      emailSuffix: 'pkg-nosub',
      planSlug: null,
    })

    const r = await teacherPackagesPost(
      buildRequest('/api/teacher/packages', {
        cookie: t.cookie,
        body: pkgBody(`nosub-pkg-${Date.now()}`),
      }),
    )
    expect(r.status).toBe(422)
    const body = await r.json()
    expect(body.error).toBe('plan_upgrade_required')
  })
})

describe('free-tier 1pkg+1tariff unlock — tariffs cap', () => {
  it('free teacher: tariff #1 → 201, tariff #2 → 422 tier_write_cap_reached', async () => {
    const t = await makeTeacher({
      emailSuffix: 'tariff-free-2x',
      planSlug: 'free',
    })

    const r1 = await teacherTariffsPost(
      buildRequest('/api/teacher/tariffs', {
        cookie: t.cookie,
        body: tariffBody('Free demo tariff #1'),
      }),
    )
    expect(r1.status).toBe(201)

    const r2 = await teacherTariffsPost(
      buildRequest('/api/teacher/tariffs', {
        cookie: t.cookie,
        body: tariffBody('Free demo tariff #2'),
      }),
    )
    expect(r2.status).toBe(422)
    const body = await r2.json()
    expect(body.error).toBe('tier_write_cap_reached')
    expect(body.cap).toBe(1)
    expect(body.current).toBe(1)
    expect(body.tier).toBe('free')
  })

  it('free teacher: soft-delete tariff #1 (deleted_at), then can create tariff #2 → 201', async () => {
    const t = await makeTeacher({
      emailSuffix: 'tariff-free-archive',
      planSlug: 'free',
    })

    const r1 = await teacherTariffsPost(
      buildRequest('/api/teacher/tariffs', {
        cookie: t.cookie,
        body: tariffBody('Free archive tariff #1'),
      }),
    )
    expect(r1.status).toBe(201)
    const body1 = await r1.json()
    const tariffId1 = body1.tariff.id as string

    await getDbPool().query(
      `update pricing_tariffs
          set deleted_at = now(), is_active = false
        where id = $1`,
      [tariffId1],
    )

    const r2 = await teacherTariffsPost(
      buildRequest('/api/teacher/tariffs', {
        cookie: t.cookie,
        body: tariffBody('Free archive tariff #2'),
      }),
    )
    expect(r2.status).toBe(201)
  })

  // R1-BLOCKER wave-paranoia closure: PATCH must enforce cap on
  // reactivation. Flow: create A → archive A via PATCH (isActive=false)
  // → create B (cap=1 ok) → try to reactivate A via PATCH (isActive=true).
  // The reactivate MUST 422 because now A+B would both be active.
  it('free teacher: reactivation of archived package when at cap → 422 tier_write_cap_reached', async () => {
    const t = await makeTeacher({
      emailSuffix: 'pkg-free-reactivate',
      planSlug: 'free',
    })

    const r1 = await teacherPackagesPost(
      buildRequest('/api/teacher/packages', {
        cookie: t.cookie,
        body: pkgBody('free-react-a', 'Free pkg #1'),
      }),
    )
    expect(r1.status).toBe(201)
    const pkgAId = (await r1.json()).package.id as string

    // Archive A through the real PATCH path.
    const arch = await teacherPackagesPatch(
      buildRequest(`/api/teacher/packages/${pkgAId}`, {
        cookie: t.cookie,
        method: 'PATCH',
        body: { isActive: false },
      }),
      { params: Promise.resolve({ id: pkgAId }) },
    )
    expect(arch.status).toBe(200)

    // Create B — now at cap (1 active).
    const r2 = await teacherPackagesPost(
      buildRequest('/api/teacher/packages', {
        cookie: t.cookie,
        body: pkgBody('free-react-b', 'Free pkg #2'),
      }),
    )
    expect(r2.status).toBe(201)

    // Reactivate A — should 422 (would put us at 2 active).
    const react = await teacherPackagesPatch(
      buildRequest(`/api/teacher/packages/${pkgAId}`, {
        cookie: t.cookie,
        method: 'PATCH',
        body: { isActive: true },
      }),
      { params: Promise.resolve({ id: pkgAId }) },
    )
    expect(react.status).toBe(422)
    const body = await react.json()
    expect(body.error).toBe('tier_write_cap_reached')
    expect(body.cap).toBe(1)
    expect(body.current).toBe(1)
  })

  // R2-BLOCKER closure (wave-paranoia round 2): mid/pro/no-subscription
  // teacher reactivating an archived package must get the same
  // plan_upgrade_required code as POST, not tier_write_cap_reached.
  it('mid-tier teacher: reactivation → 422 plan_upgrade_required (NOT tier_write_cap_reached)', async () => {
    // Seed an archived package directly for a mid-tier teacher (POST
    // would 422 first, so create the row manually with is_active=false).
    const free = await makeTeacher({
      emailSuffix: 'react-mid-seed-free',
      planSlug: 'free',
    })
    const r1 = await teacherPackagesPost(
      buildRequest('/api/teacher/packages', {
        cookie: free.cookie,
        body: pkgBody('mid-react-pkg', 'Will be donated to mid teacher'),
      }),
    )
    expect(r1.status).toBe(201)
    const pkgId = (await r1.json()).package.id as string

    // Re-assign the row to a mid-tier teacher + archive it.
    const mid = await makeTeacher({
      emailSuffix: 'react-mid-downgraded',
      planSlug: 'mid',
    })
    await getDbPool().query(
      `update lesson_packages
          set teacher_id = $1::uuid, is_active = false
        where id = $2::uuid`,
      [mid.id, pkgId],
    )

    const react = await teacherPackagesPatch(
      buildRequest(`/api/teacher/packages/${pkgId}`, {
        cookie: mid.cookie,
        method: 'PATCH',
        body: { isActive: true },
      }),
      { params: Promise.resolve({ id: pkgId }) },
    )
    expect(react.status).toBe(422)
    const body = await react.json()
    expect(body.error).toBe('plan_upgrade_required')
  })

  it('mid-tier teacher: tariff create → 422 plan_upgrade_required (cap=0)', async () => {
    const t = await makeTeacher({
      emailSuffix: 'tariff-mid-blocked',
      planSlug: 'mid',
    })

    const r = await teacherTariffsPost(
      buildRequest('/api/teacher/tariffs', {
        cookie: t.cookie,
        body: tariffBody('Mid blocked tariff'),
      }),
    )
    expect(r.status).toBe(422)
    const body = await r.json()
    expect(body.error).toBe('plan_upgrade_required')
  })
})
