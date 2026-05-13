import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { readJsonObjectOr400 } from '@/lib/api/json-body'
import { requireAdminRole } from '@/lib/auth/guards'
import {
  type TariffInput,
  createTariff,
  listAllTariffs,
  validateTariffInput,
} from '@/lib/pricing/tariffs'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
} from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'


export async function GET(request: Request) {
  const rl = await enforceRateLimit(request, 'admin:pricing:ip', 60, 60_000)
  if (rl) return rl

  const guard = await requireAdminRole(request)
  if (!guard.ok) return guard.response

  const tariffs = await listAllTariffs()
  return NextResponse.json({ tariffs }, { status: 200, headers: NO_STORE })
}

export async function POST(request: Request) {
  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate

  const rl = await enforceRateLimit(request, 'admin:pricing:ip', 30, 60_000)
  if (rl) return rl

  const guard = await requireAdminRole(request)
  if (!guard.ok) return guard.response

  const parsed = await readJsonObjectOr400(request)
  if (!parsed.ok) return parsed.response
  const raw = parsed.body
  const input: Partial<TariffInput> = {}
  if (typeof raw.slug === 'string') input.slug = raw.slug
  if (typeof raw.titleRu === 'string') input.titleRu = raw.titleRu
  if (typeof raw.descriptionRu === 'string' || raw.descriptionRu === null) {
    input.descriptionRu = raw.descriptionRu as string | null
  }
  if (typeof raw.amountKopecks === 'number') {
    input.amountKopecks = raw.amountKopecks
  }
  if (typeof raw.durationMinutes === 'number') {
    input.durationMinutes = raw.durationMinutes
  }
  if (typeof raw.isActive === 'boolean') input.isActive = raw.isActive
  if (typeof raw.displayOrder === 'number') {
    input.displayOrder = raw.displayOrder
  }

  if (
    typeof input.slug !== 'string' ||
    typeof input.titleRu !== 'string' ||
    typeof input.amountKopecks !== 'number' ||
    typeof input.durationMinutes !== 'number'
  ) {
    return NextResponse.json(
      { error: 'slug, titleRu, amountKopecks, durationMinutes are required.' },
      { status: 400, headers: NO_STORE },
    )
  }

  const validation = validateTariffInput(input)
  if (validation) {
    return NextResponse.json(
      { error: `${validation.field}/${validation.reason}` },
      { status: 400, headers: NO_STORE },
    )
  }

  try {
    const tariff = await createTariff(input as TariffInput)
    return NextResponse.json({ tariff }, { status: 201, headers: NO_STORE })
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
