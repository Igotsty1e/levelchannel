import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { readJsonObjectOr400 } from '@/lib/api/json-body'
import { requireTeacherAndVerified } from '@/lib/auth/guards'
import {
  createPackage,
  listPackagesByTeacher,
} from '@/lib/billing/packages'
import { isOperatorManagedTeacher } from '@/lib/payments/teacher-derivation'
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
  const guard = await requireTeacherAndVerified(request)
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

  const guard = await requireTeacherAndVerified(request)
  if (!guard.ok) return guard.response

  // SAAS-PIVOT security-audit HIGH-2 (2026-05-23) closure — plan-4
  // gate at create time. Only operator-managed (plan-4) teachers can
  // publish a paid package that learners can buy through
  // /api/checkout/package/[slug] (where the platform settles via
  // CloudPayments). A Free/Mid/Pro teacher creating a paid package
  // whose buy commits a payment_orders row pointing at THEIR
  // teacher_account_id would orphan the funds — the platform has no
  // disbursement path to non-plan-4 teachers. They must use the
  // non-money `teacher_grant` issue path (/teacher/packages/[id]/issue)
  // OR settle out-of-band.
  const isPlan4 = await isOperatorManagedTeacher(guard.account.id)
  if (!isPlan4) {
    return NextResponse.json(
      {
        error: 'plan_4_required',
        message:
          'Только Plan-4 учителя могут публиковать платные пакеты. Используйте teacher_grant (выдать ученику) или оплату напрямую.',
      },
      { status: 422, headers: NO_STORE },
    )
  }

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

  try {
    const pkg = await createPackage({
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
    return NextResponse.json(
      { package: pkg },
      { status: 201, headers: NO_STORE },
    )
  } catch (err) {
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
  }
}
