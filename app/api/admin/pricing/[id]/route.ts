import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { readJsonObjectOr400 } from '@/lib/api/json-body'
import { requireAdminRole } from '@/lib/auth/guards'
import {
  type TariffPatch,
  deleteTariffIfUnreferenced,
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

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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
      { error: 'not_found', message: 'Not found.' },
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
        { error: 'not_found', message: 'Not found.' },
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

// BUG-2 (2026-05-13 intake): hard-delete a tariff row. Only allowed
// when zero lesson_slot rows reference it (current or past). The FK is
// `on delete set null`, so cascading is technically possible — but
// that silently wipes the audit/billing trail of which tariff a slot
// was bound to. Refuse with 409 instead and tell the operator to
// deactivate.
export async function DELETE(request: Request, { params }: RouteParams) {
  const { id } = await params
  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate

  const rl = await enforceRateLimit(request, 'admin:pricing:ip', 30, 60_000)
  if (rl) return rl

  const guard = await requireAdminRole(request)
  if (!guard.ok) return guard.response

  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json(
      { error: 'not_found' },
      { status: 404, headers: NO_STORE },
    )
  }

  // BUG-2 audit: snapshot the tariff BEFORE the helper deletes it so a
  // forensic question ("which row did admin X delete on date Y?") can
  // be answered from the structured log stream (systemd journal in
  // prod). When/if ops asks for a formal DB audit table, this snapshot
  // is exactly the payload we'd want to persist; see
  // lib/audit/payment-events.ts for the existing pattern + the
  // migration sequence used to widen the event_type enum.
  const snapshot = await getTariffById(id)

  const result = await deleteTariffIfUnreferenced(id)
  if (result.ok) {
    if (snapshot) {
      console.info(
        '[admin-audit] tariff.deleted',
        JSON.stringify({
          actor: guard.account.id,
          tariff: snapshot,
          at: new Date().toISOString(),
        }),
      )
    }
    return NextResponse.json(
      { ok: true, deleted: id },
      { status: 200, headers: NO_STORE },
    )
  }
  if (result.reason === 'not_found') {
    return NextResponse.json(
      { error: 'not_found' },
      { status: 404, headers: NO_STORE },
    )
  }
  // has_slot_references — operator must deactivate instead.
  return NextResponse.json(
    {
      error: 'has_slot_references',
      message:
        'Тариф уже привязан к слотам и не может быть удалён без потери истории. Снимите галочку «активен», чтобы скрыть тариф из новых форм.',
      slotCount: result.slotCount,
    },
    { status: 409, headers: NO_STORE },
  )
}
