import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { readJsonObjectOr400 } from '@/lib/api/json-body'
import { requireTeacherAndVerified } from '@/lib/auth/guards'
import {
  getPackageById,
  updatePackageMetadata,
} from '@/lib/billing/packages'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
} from '@/lib/security/request'

// SAAS-PIVOT Epic 3 Day 4 (2026-05-22) — teacher-owned package metadata
// edit. Same shape as /api/admin/packages/[id]/route.ts but scoped by
// teacher_id ownership: a teacher CAN'T edit another teacher's package
// (404 not_found to avoid leaking existence).
//
// Economic fields stay immutable (DB trigger from mig 0033 refuses
// the UPDATE once any purchase exists); the route also pre-rejects
// any body that names them.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type RouteParams = { params: Promise<{ id: string }> }

export async function PATCH(request: Request, { params }: RouteParams) {
  const { id } = await params
  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json(
      { error: 'not_found' },
      { status: 404, headers: NO_STORE },
    )
  }

  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate

  const rl = await enforceRateLimit(
    request,
    'teacher:packages:update',
    20,
    60_000,
  )
  if (rl) return rl

  const guard = await requireTeacherAndVerified(request)
  if (!guard.ok) return guard.response

  // Anti-spoof: re-verify the package belongs to this teacher. We
  // return 404 (not 403) on a foreign id so the route doesn't leak
  // existence of another teacher's package.
  const existing = await getPackageById(id)
  if (!existing) {
    return NextResponse.json(
      { error: 'not_found' },
      { status: 404, headers: NO_STORE },
    )
  }
  if (existing.teacherId !== guard.account.id) {
    return NextResponse.json(
      { error: 'not_found' },
      { status: 404, headers: NO_STORE },
    )
  }

  const parsed = await readJsonObjectOr400(request)
  if (!parsed.ok) return parsed.response
  const b = parsed.body

  const patch: Parameters<typeof updatePackageMetadata>[1] = {}
  if (typeof b.titleRu === 'string') {
    const t = b.titleRu.trim()
    if (!t) {
      return NextResponse.json(
        { error: 'titleRu cannot be empty' },
        { status: 400, headers: NO_STORE },
      )
    }
    patch.titleRu = t
  }
  if (typeof b.descriptionRu === 'string' || b.descriptionRu === null) {
    patch.descriptionRu =
      typeof b.descriptionRu === 'string' ? b.descriptionRu.trim() || null : null
  }
  if (typeof b.isActive === 'boolean') {
    patch.isActive = b.isActive
  }
  if (typeof b.displayOrder === 'number' && Number.isInteger(b.displayOrder)) {
    patch.displayOrder = b.displayOrder
  }

  // Reject any attempt to send the immutable monetary / identity
  // fields. Same shape as /api/admin/packages/[id]/route.ts. teacher_id
  // is added: a teacher MUST NOT be able to re-assign a package to a
  // different teacher via this route.
  for (const blocked of [
    'amountKopecks',
    'amount_kopecks',
    'durationMinutes',
    'duration_minutes',
    'count',
    'currency',
    'slug',
    'teacherId',
    'teacher_id',
  ] as const) {
    if (blocked in b) {
      return NextResponse.json(
        {
          error: 'immutable_field',
          message: `Поле ${blocked} нельзя изменить после создания. Деактивируйте пакет и создайте новый.`,
        },
        { status: 400, headers: NO_STORE },
      )
    }
  }

  try {
    const updated = await updatePackageMetadata(id, patch)
    if (!updated) {
      return NextResponse.json(
        { error: 'not_found' },
        { status: 404, headers: NO_STORE },
      )
    }
    return NextResponse.json(
      { package: updated },
      { status: 200, headers: NO_STORE },
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    console.warn('[teacher.packages.update] unexpected error', {
      teacherId: guard.account.id,
      id,
      error: msg,
    })
    return NextResponse.json(
      { error: 'internal_error' },
      { status: 500, headers: NO_STORE },
    )
  }
}
