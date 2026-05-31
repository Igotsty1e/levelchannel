import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { readJsonObjectOr400 } from '@/lib/api/json-body'
import { requireTeacherWithCurrentSaasOfferConsent } from '@/lib/auth/guards'
import {
  type BulkCreateInput,
  bulkCreateSlots,
  SlotTeacherRoleError,
  TariffNotActiveError,
  TariffOwnershipError,
} from '@/lib/scheduling/slots'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
} from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'


// Wave C — teacher bulk-create. Same shape as the admin equivalent
// but binds teacherAccountId from session (body is ignored).

export async function POST(request: Request) {
  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate

  const rl = await enforceRateLimit(
    request,
    'teacher:slots:bulk:ip',
    20,
    60_000,
  )
  if (rl) return rl

  const guard = await requireTeacherWithCurrentSaasOfferConsent(request)
  if (!guard.ok) return guard.response

  const parsed = await readJsonObjectOr400(request, { coded: true })
  if (!parsed.ok) return parsed.response
  const raw = parsed.body

  const input: Partial<BulkCreateInput> = {
    teacherAccountId: guard.account.id, // bound to session
  }
  if (typeof raw.durationMinutes === 'number') {
    input.durationMinutes = raw.durationMinutes
  }
  if (typeof raw.notes === 'string' || raw.notes === null) {
    input.notes = raw.notes as string | null
  }
  if (typeof raw.tariffId === 'string' || raw.tariffId === null) {
    input.tariffId = raw.tariffId as string | null
  }
  if (Array.isArray(raw.slots)) {
    input.slots = raw.slots
      .filter(
        (s): s is { startAt: string } =>
          typeof s === 'object' &&
          s !== null &&
          typeof (s as Record<string, unknown>).startAt === 'string',
      )
      .map((s) => ({ startAt: s.startAt }))
  }

  if (
    typeof input.durationMinutes !== 'number' ||
    !Array.isArray(input.slots)
  ) {
    return NextResponse.json(
      { error: 'durationMinutes and slots[] are required.' },
      { status: 400, headers: NO_STORE },
    )
  }

  try {
    const result = await bulkCreateSlots(input as BulkCreateInput)
    return NextResponse.json(
      {
        created: result.created,
        skippedConflicts: result.skippedConflicts,
      },
      { status: 201, headers: NO_STORE },
    )
  } catch (err) {
    if (err instanceof TariffNotActiveError) {
      return NextResponse.json(
        {
          error:
            err.reason === 'soft_deleted'
              ? 'slot/tariffId/archived'
              : 'slot/tariffId/unknown',
          message:
            err.reason === 'soft_deleted'
              ? 'Этот тариф архивирован — выберите другой.'
              : 'Тариф не найден.',
        },
        { status: 400, headers: NO_STORE },
      )
    }
    if (err instanceof TariffOwnershipError) {
      return NextResponse.json(
        {
          error: 'slot/tariffId/wrong_teacher',
          message: 'Этот тариф принадлежит другому учителю.',
        },
        { status: 403, headers: NO_STORE },
      )
    }
    if (err instanceof SlotTeacherRoleError) {
      return NextResponse.json(
        {
          error: 'internal_role_check',
          message: 'Внутренняя ошибка проверки роли.',
        },
        { status: 500, headers: NO_STORE },
      )
    }
    // Unknown errors → 500 with logging; mirrors single-create.
    console.error('[teacher.slots.bulk-create] unexpected error', err)
    return NextResponse.json(
      { error: 'internal_error' },
      { status: 500, headers: NO_STORE },
    )
  }
}
