import { NextResponse } from 'next/server'

import { readJsonObjectOr400 } from '@/lib/api/json-body'
import { requireAdminRole } from '@/lib/auth/guards'
import {
  type TariffPatch,
  getTariffById,
  updateTariff,
  validateTariffInput,
} from '@/lib/pricing/tariffs'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
} from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' }

type RouteParams = { params: Promise<{ id: string }> }

export async function GET(request: Request, { params }: RouteParams) {
  const { id } = await params
  const rl = await enforceRateLimit(request, 'admin:pricing:ip', 60, 60_000)
  if (rl) return rl
  const guard = await requireAdminRole(request)
  if (!guard.ok) return guard.response

  const tariff = await getTariffById(id)
  if (!tariff) {
    return NextResponse.json(
      { error: 'Not found.' },
      { status: 404, headers: NO_STORE },
    )
  }
  return NextResponse.json({ tariff }, { status: 200, headers: NO_STORE })
}

export async function PATCH(request: Request, { params }: RouteParams) {
  const { id } = await params
  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate

  const rl = await enforceRateLimit(request, 'admin:pricing:ip', 30, 60_000)
  if (rl) return rl

  const guard = await requireAdminRole(request)
  if (!guard.ok) return guard.response

  const parsed = await readJsonObjectOr400(request)
  if (!parsed.ok) return parsed.response
  const raw = parsed.body
  const patch: TariffPatch = {}
  if ('slug' in raw && typeof raw.slug === 'string') patch.slug = raw.slug
  if ('titleRu' in raw && typeof raw.titleRu === 'string') {
    patch.titleRu = raw.titleRu
  }
  if (
    'descriptionRu' in raw &&
    (typeof raw.descriptionRu === 'string' || raw.descriptionRu === null)
  ) {
    patch.descriptionRu = raw.descriptionRu as string | null
  }
  if ('amountKopecks' in raw && typeof raw.amountKopecks === 'number') {
    patch.amountKopecks = raw.amountKopecks
  }
  if ('isActive' in raw && typeof raw.isActive === 'boolean') {
    patch.isActive = raw.isActive
  }
  if ('displayOrder' in raw && typeof raw.displayOrder === 'number') {
    patch.displayOrder = raw.displayOrder
  }

  const validation = validateTariffInput(patch)
  if (validation) {
    return NextResponse.json(
      { error: `${validation.field}/${validation.reason}` },
      { status: 400, headers: NO_STORE },
    )
  }

  try {
    const tariff = await updateTariff(id, patch)
    if (!tariff) {
      return NextResponse.json(
        { error: 'Not found.' },
        { status: 404, headers: NO_STORE },
      )
    }
    return NextResponse.json({ tariff }, { status: 200, headers: NO_STORE })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown'
    if (message.includes('pricing_tariffs_slug_unique')) {
      return NextResponse.json(
        { error: 'slug/already_taken' },
        { status: 409, headers: NO_STORE },
      )
    }
    throw err
  }
}
