import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { readJsonObjectOr400 } from '@/lib/api/json-body'
import { requireTeacherAndVerified } from '@/lib/auth/guards'
import {
  type TariffPatch,
  getTariffForTeacher,
  softDeleteTariffForTeacher,
  updateTariffForTeacher,
  validateTariffInput,
} from '@/lib/pricing/tariffs'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
} from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// SAAS-PIVOT Epic 2 Day 3 — per-tariff teacher CRUD endpoints.
//
// Plan: docs/plans/saas-pivot-master.md §3 Epic 2.
//
// Anti-spoof: every mutation re-checks `teacher_id = $session` in the
// data-layer UPDATE/DELETE WHERE clause. 404 on (a) not_found,
// (b) belongs to a different teacher, (c) already soft-deleted — all
// collapsed to one error to avoid leaking existence.

type RouteParams = { params: Promise<{ id: string }> }

export async function GET(request: Request, { params }: RouteParams) {
  const { id } = await params
  const rl = await enforceRateLimit(request, 'teacher:tariffs:ip', 60, 60_000)
  if (rl) return rl

  const guard = await requireTeacherAndVerified(request)
  if (!guard.ok) return guard.response

  const tariff = await getTariffForTeacher(id, guard.account.id, {
    includeArchived: true,
  })
  if (!tariff) {
    return NextResponse.json(
      { error: 'not_found', message: 'Тариф не найден.' },
      { status: 404, headers: NO_STORE },
    )
  }
  return NextResponse.json({ tariff }, { status: 200, headers: NO_STORE })
}

export async function PATCH(request: Request, { params }: RouteParams) {
  const { id } = await params
  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate

  const rl = await enforceRateLimit(request, 'teacher:tariffs:ip', 30, 60_000)
  if (rl) return rl

  const guard = await requireTeacherAndVerified(request)
  if (!guard.ok) return guard.response

  const parsed = await readJsonObjectOr400(request)
  if (!parsed.ok) return parsed.response
  const raw = parsed.body
  const patch: TariffPatch = {}
  // Body's teacherId, slug, etc. are explicitly ignored — slug is
  // server-synthesised at create; teacherId is bound from session.
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
  if ('durationMinutes' in raw && typeof raw.durationMinutes === 'number') {
    patch.durationMinutes = raw.durationMinutes
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
    const tariff = await updateTariffForTeacher(id, guard.account.id, patch)
    if (!tariff) {
      return NextResponse.json(
        { error: 'not_found', message: 'Тариф не найден.' },
        { status: 404, headers: NO_STORE },
      )
    }
    return NextResponse.json({ tariff }, { status: 200, headers: NO_STORE })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown'
    if (message.includes('immutable_after_first_slot_reference')) {
      const field = message.includes('amountKopecks')
        ? 'amountKopecks'
        : 'durationMinutes'
      return NextResponse.json(
        {
          error: `${field}/immutable_after_first_slot_reference`,
          message:
            field === 'durationMinutes'
              ? 'Длительность тарифа нельзя изменить после первой привязки к слоту. Создайте новый тариф под другую длительность.'
              : 'Цену тарифа нельзя изменить после первой привязки к слоту. Создайте новый тариф с новой ценой.',
        },
        { status: 409, headers: NO_STORE },
      )
    }
    console.error('[teacher.tariffs.update] unexpected error', err)
    return NextResponse.json(
      { error: 'internal_error' },
      { status: 500, headers: NO_STORE },
    )
  }
}

export async function DELETE(request: Request, { params }: RouteParams) {
  const { id } = await params
  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate

  const rl = await enforceRateLimit(request, 'teacher:tariffs:ip', 30, 60_000)
  if (rl) return rl

  const guard = await requireTeacherAndVerified(request)
  if (!guard.ok) return guard.response

  const result = await softDeleteTariffForTeacher(id, guard.account.id)
  if (result.ok) {
    console.info(
      '[teacher-audit] tariff.archived',
      JSON.stringify({
        actor: guard.account.id,
        tariff: result.tariff,
        at: new Date().toISOString(),
      }),
    )
    return NextResponse.json(
      { ok: true, archived: id },
      { status: 200, headers: NO_STORE },
    )
  }
  return NextResponse.json(
    { error: 'not_found', message: 'Тариф не найден.' },
    { status: 404, headers: NO_STORE },
  )
}
