import { NextResponse } from 'next/server'

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

const noStore = { 'Cache-Control': 'no-store, max-age=0' }

export async function GET(request: Request) {
  const rl = await enforceRateLimit(request, 'admin:pricing:ip', 60, 60_000)
  if (rl) return rl

  const guard = await requireAdminRole(request)
  if (!guard.ok) return guard.response

  const tariffs = await listAllTariffs()
  return NextResponse.json({ tariffs }, { status: 200, headers: noStore })
}

export async function POST(request: Request) {
  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate

  const rl = await enforceRateLimit(request, 'admin:pricing:ip', 30, 60_000)
  if (rl) return rl

  const guard = await requireAdminRole(request)
  if (!guard.ok) return guard.response

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body.' },
      { status: 400, headers: noStore },
    )
  }
  if (typeof body !== 'object' || body === null) {
    return NextResponse.json(
      { error: 'Body must be a JSON object.' },
      { status: 400, headers: noStore },
    )
  }
  const raw = body as Record<string, unknown>
  const input: Partial<TariffInput> = {}
  if (typeof raw.slug === 'string') input.slug = raw.slug
  if (typeof raw.titleRu === 'string') input.titleRu = raw.titleRu
  if (typeof raw.descriptionRu === 'string' || raw.descriptionRu === null) {
    input.descriptionRu = raw.descriptionRu as string | null
  }
  if (typeof raw.amountKopecks === 'number') {
    input.amountKopecks = raw.amountKopecks
  }
  if (typeof raw.isActive === 'boolean') input.isActive = raw.isActive
  if (typeof raw.displayOrder === 'number') {
    input.displayOrder = raw.displayOrder
  }

  if (
    typeof input.slug !== 'string' ||
    typeof input.titleRu !== 'string' ||
    typeof input.amountKopecks !== 'number'
  ) {
    return NextResponse.json(
      { error: 'slug, titleRu, amountKopecks are required.' },
      { status: 400, headers: noStore },
    )
  }

  const validation = validateTariffInput(input)
  if (validation) {
    return NextResponse.json(
      { error: `${validation.field}/${validation.reason}` },
      { status: 400, headers: noStore },
    )
  }

  try {
    const tariff = await createTariff(input as TariffInput)
    return NextResponse.json({ tariff }, { status: 201, headers: noStore })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown'
    if (message.includes('pricing_tariffs_slug_unique')) {
      return NextResponse.json(
        { error: 'slug/already_taken' },
        { status: 409, headers: noStore },
      )
    }
    throw err
  }
}
