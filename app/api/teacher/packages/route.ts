import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { readJsonObjectOr400 } from '@/lib/api/json-body'
import { requireTeacherWithCurrentSaasOfferConsent } from '@/lib/auth/guards'
import {
  countActivePackagesByTeacherTx,
  createPackageTx,
  listPackagesByTeacher,
} from '@/lib/billing/packages'
import { resolveTeacherWriteCaps } from '@/lib/billing/teacher-subscription'
import { getDbPool } from '@/lib/db/pool'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
} from '@/lib/security/request'

// SAAS-PIVOT Epic 3 Day 4 (2026-05-22) — teacher-owned packages CRUD.
//
// Plan: docs/plans/saas-pivot-master.md §3 Epic 3 (teacher-owned
// packages) + §5 Day 4 step 9.
//
// GET   /api/teacher/packages          — list this teacher's catalog.
// POST  /api/teacher/packages          — create a new package owned by
//                                         the authenticated teacher.
//
// Anti-spoof: every write writes teacher_id = session.account.id from
// the SERVER session; the body never carries a teacher_id field. The
// SQL UNIQUE(teacher_id, slug) (mig 0076b) means two teachers can ship
// the same slug independently; a same-slug retry within a teacher's
// catalog returns 409.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DEFAULT_DISPLAY_ORDER = 100

export async function GET(request: Request) {
  const guard = await requireTeacherWithCurrentSaasOfferConsent(request)
  if (!guard.ok) return guard.response

  const packages = await listPackagesByTeacher(guard.account.id)
  return NextResponse.json(
    {
      packages: packages.map((p) => ({
        id: p.id,
        slug: p.slug,
        titleRu: p.titleRu,
        descriptionRu: p.descriptionRu,
        durationMinutes: p.durationMinutes,
        count: p.count,
        amountKopecks: p.amountKopecks,
        currency: p.currency,
        isActive: p.isActive,
        displayOrder: p.displayOrder,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      })),
    },
    { status: 200, headers: NO_STORE },
  )
}

export async function POST(request: Request) {
  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate

  const rl = await enforceRateLimit(
    request,
    'teacher:packages:create',
    10,
    60_000,
  )
  if (rl) return rl

  const guard = await requireTeacherWithCurrentSaasOfferConsent(request)
  if (!guard.ok) return guard.response

  const parsed = await readJsonObjectOr400(request)
  if (!parsed.ok) return parsed.response
  const body = parsed.body

  const slug = typeof body.slug === 'string' ? body.slug.trim() : null
  const titleRu = typeof body.titleRu === 'string' ? body.titleRu.trim() : null
  const durationMinutes =
    typeof body.durationMinutes === 'number' ? body.durationMinutes : null
  const count = typeof body.count === 'number' ? body.count : null
  const amountKopecks =
    typeof body.amountKopecks === 'number' ? body.amountKopecks : null

  if (!slug || !titleRu || !durationMinutes || !count || !amountKopecks) {
    return NextResponse.json(
      {
        error:
          'slug, titleRu, durationMinutes, count, amountKopecks are required',
      },
      { status: 400, headers: NO_STORE },
    )
  }

  // Defensive: reject any caller-supplied teacher_id. The owning
  // teacher is ALWAYS the authenticated session — anti-spoof rule
  // from §3 Epic 3.
  if ('teacherId' in body || 'teacher_id' in body) {
    return NextResponse.json(
      {
        error: 'teacher_id_forbidden',
        message:
          'teacher_id is implied from the session and cannot be overridden in the body.',
      },
      { status: 400, headers: NO_STORE },
    )
  }

  // Free-tier 1pkg+1tariff unlock (2026-06-02). Plan:
  // docs/plans/free-tier-1pkg-1tariff-unlock.md §3.
  //
  // Replaces the old `isOperatorManagedTeacher` gate. Now tier-aware:
  //   - free → maxPackages=1 (can create 1 demo package).
  //   - mid/pro → maxPackages=0 (cap=0, returns plan_upgrade_required).
  //   - operator-managed → maxPackages=Infinity.
  //   - no row / non-active state → maxPackages=0 (same as mid/pro).
  //
  // Buyer-side gates in /api/checkout/package/[slug],
  // /api/payments/sbp/create-qr, /api/payments/charge-token are
  // UNCHANGED — they still 422 plan_4_required for non-operator-managed
  // teachers. The free-tier package is a structural template the
  // teacher can issue via teacher_grant or settle out-of-band; it can
  // NOT be sold through the platform. This is the architectural escape
  // valve that makes the unlock safe.
  //
  // Race condition mitigation (R1-BLOCKER#2 closure): open a TX +
  // pg_advisory_xact_lock keyed on `tier-cap:<teacherId>` so two
  // concurrent POSTs from the same teacher are serialized. The count +
  // insert run on the same client; rollback on cap-exceeded so the
  // INSERT never lands.
  const pool = getDbPool()
  const client = await pool.connect()
  try {
    await client.query('begin')
    await client.query(
      `select pg_advisory_xact_lock(hashtext('tier-cap:' || $1::text))`,
      [guard.account.id],
    )
    const caps = await resolveTeacherWriteCaps(guard.account.id)
    if (caps.maxPackages <= 0) {
      await client.query('rollback')
      return NextResponse.json(
        {
          error: 'plan_upgrade_required',
          message:
            'Создание пакетов недоступно на вашем тарифе. Перейдите на тариф с пакетами или свяжитесь с оператором LevelChannel.',
        },
        { status: 422, headers: NO_STORE },
      )
    }
    const current = await countActivePackagesByTeacherTx(client, guard.account.id)
    if (current >= caps.maxPackages) {
      await client.query('rollback')
      // Tier slug for the body (free is the only finite-cap tier in
      // 2026-06-02; mid/pro hit the cap=0 branch above; operator-
      // managed never hits this branch).
      const tier: 'free' = 'free'
      return NextResponse.json(
        {
          error: 'tier_write_cap_reached',
          message:
            'Лимит пакетов на тарифе исчерпан. Архивируйте старый пакет, чтобы создать новый.',
          cap: caps.maxPackages,
          current,
          tier,
        },
        { status: 422, headers: NO_STORE },
      )
    }
    const pkg = await createPackageTx(client, {
      slug,
      titleRu,
      descriptionRu:
        typeof body.descriptionRu === 'string' ? body.descriptionRu : null,
      durationMinutes,
      count,
      amountKopecks,
      isActive: typeof body.isActive === 'boolean' ? body.isActive : true,
      displayOrder:
        typeof body.displayOrder === 'number'
          ? body.displayOrder
          : DEFAULT_DISPLAY_ORDER,
      teacherId: guard.account.id,
    })
    await client.query('commit')
    return NextResponse.json(
      { package: pkg },
      { status: 201, headers: NO_STORE },
    )
  } catch (err) {
    try {
      await client.query('rollback')
    } catch {
      // ignore — already in a failed state
    }
    const msg = err instanceof Error ? err.message : 'unknown'
    const code = (err as { code?: string } | null)?.code ?? ''
    if (
      code === '23505'
      || msg.includes('lesson_packages_teacher_slug_unique')
    ) {
      return NextResponse.json(
        { error: 'slug_already_exists' },
        { status: 409, headers: NO_STORE },
      )
    }
    if (code === '23514') {
      return NextResponse.json(
        { error: 'invalid_input' },
        { status: 400, headers: NO_STORE },
      )
    }
    console.warn('[teacher.packages.create] unexpected error', {
      teacherId: guard.account.id,
      error: msg,
    })
    return NextResponse.json(
      { error: 'internal_error' },
      { status: 500, headers: NO_STORE },
    )
  } finally {
    client.release()
  }
}
