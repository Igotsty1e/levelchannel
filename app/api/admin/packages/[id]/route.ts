import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { readJsonObjectOr400 } from '@/lib/api/json-body'
import { requireAdminRole } from '@/lib/auth/guards'
import { updatePackageMetadata } from '@/lib/billing/packages'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
} from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'


// Wave 15 — admin metadata edit + soft-archive for lesson_packages.
//
// Allowed fields: title_ru, description_ru, is_active, display_order.
// Refused (always — by the DB trigger
// `lesson_packages_economic_fields_immutable`): amount_kopecks,
// duration_minutes, count, currency. Monetary edits remain
// "deactivate old + create new" by design (Wave 12 invariant —
// already-purchased packages stay bit-for-bit identical to what the
// learner saw at purchase time).
//
// Slug is also intentionally not editable: it's the public stable
// identifier embedded in checkout URLs, and changing it would break
// any saved bookmarks. Archive + create-with-new-slug instead.

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
    'admin:packages:update',
    20,
    60_000,
  )
  if (rl) return rl

  const guard = await requireAdminRole(request)
  if (!guard.ok) return guard.response

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

  // Reject any attempt to send the immutable monetary fields. We
  // could silently drop them (current shape) but explicit > implicit:
  // surface the contract so the operator UI doesn't silently no-op
  // an attempted price edit.
  for (const blocked of [
    'amountKopecks',
    'amount_kopecks',
    'durationMinutes',
    'duration_minutes',
    'count',
    'currency',
    'slug',
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
    console.warn('[admin.packages.update] unexpected error', { id, error: msg })
    return NextResponse.json(
      { error: 'internal_error' },
      { status: 500, headers: NO_STORE },
    )
  }
}
