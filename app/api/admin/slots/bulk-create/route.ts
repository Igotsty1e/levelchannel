import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { readJsonObjectOr400 } from '@/lib/api/json-body'
import { requireAdminRole } from '@/lib/auth/guards'
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


// POST /api/admin/slots/bulk-create
// Body:
//   {
//     teacherAccountId, durationMinutes, notes?,
//     slots: [{ startAt }, ...]
//   }
//
// Atomic-batch insert. Conflicts on (teacher_account_id, start_at)
// skip without aborting the batch — the response surfaces both the
// created rows and the conflicting startAts so the UI can tell the
// operator which ones already existed.

export async function POST(request: Request) {
  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate

  const rl = await enforceRateLimit(request, 'admin:slots:ip', 30, 60_000)
  if (rl) return rl

  const guard = await requireAdminRole(request)
  if (!guard.ok) return guard.response

  const parsed = await readJsonObjectOr400(request)
  if (!parsed.ok) return parsed.response
  const raw = parsed.body

  const input: Partial<BulkCreateInput> = {}
  if (typeof raw.teacherAccountId === 'string') {
    input.teacherAccountId = raw.teacherAccountId
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
    typeof input.teacherAccountId !== 'string' ||
    typeof input.durationMinutes !== 'number' ||
    !Array.isArray(input.slots)
  ) {
    return NextResponse.json(
      {
        error:
          'teacherAccountId, durationMinutes, slots[] are required.',
      },
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
        },
        { status: 400, headers: NO_STORE },
      )
    }
    if (err instanceof TariffOwnershipError) {
      return NextResponse.json(
        {
          error: 'slot/tariffId/wrong_teacher',
          message:
            'Этот тариф принадлежит другому учителю. Выберите тариф учителя или смените учителя слотов.',
        },
        { status: 400, headers: NO_STORE },
      )
    }
    if (err instanceof SlotTeacherRoleError) {
      return NextResponse.json(
        {
          error:
            'Этот аккаунт не зарегистрирован как преподаватель. Сначала выдайте роль teacher.',
        },
        { status: 400, headers: NO_STORE },
      )
    }
    const msg = err instanceof Error ? err.message : 'unknown'
    // lib/scheduling/slots.ts throws `slot/<field>/<reason>` for known
    // input-validation failures (slots/empty, slots/too_many,
    // tariffId/invalid, etc.) — keep these as 400.
    if (msg.startsWith('slot/')) {
      return NextResponse.json(
        { error: msg },
        { status: 400, headers: NO_STORE },
      )
    }
    console.warn('[admin.slots.bulk-create] unexpected error', { error: msg })
    return NextResponse.json(
      { error: 'internal_error' },
      { status: 500, headers: NO_STORE },
    )
  }
}
