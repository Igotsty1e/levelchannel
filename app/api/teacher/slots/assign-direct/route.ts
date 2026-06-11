// POST /api/teacher/slots/assign-direct
//
// teacher-direct-assign (Задача 2.2, 2026-06-11). Teacher creates an
// already-booked slot for a specific learner with a tariff. Mirrors
// POST /api/teacher/slots (open-slot create) but binds learnerAccountId
// and runs through the same billing pipeline as bookSlot.
//
// Body: {
//   learnerAccountId: UUID,
//   startAt: ISO string,
//   durationMinutes: int,
//   tariffId: UUID,
//   notes?: string|null,
// }
//
// Wire safety:
//   - teacher_account_id BOUND from session, NEVER body.
//   - readJsonObjectOr400 enforces shape pre-handler.
//   - rate-limit: 30 / min IP (mirrors /api/teacher/slots).
//   - origin guard: enforceTrustedBrowserOrigin (CSRF gate).

import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { readJsonObjectOr400 } from '@/lib/api/json-body'
import { requireTeacherWithCurrentSaasOfferConsent } from '@/lib/auth/guards'
import {
  type AssignSlotDirectInput,
  assignSlotDirect,
} from '@/lib/scheduling/slots'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
} from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate

  // Stricter rate-limit than open-slot create: direct-assign mutates a
  // billing-bearing booked row + sends an email. 10 / minute / IP is
  // generous for a teacher composing a few lessons by hand and blocks
  // scripted abuse.
  const rl = await enforceRateLimit(
    request,
    'teacher:assign-direct:ip',
    10,
    60_000,
  )
  if (rl) return rl

  const guard = await requireTeacherWithCurrentSaasOfferConsent(request)
  if (!guard.ok) return guard.response

  const parsed = await readJsonObjectOr400(request, { coded: true })
  if (!parsed.ok) return parsed.response
  const raw = parsed.body

  if (typeof raw.learnerAccountId !== 'string') {
    return badRequest('learnerAccountId/missing')
  }
  if (typeof raw.startAt !== 'string') {
    return badRequest('startAt/missing')
  }
  if (typeof raw.durationMinutes !== 'number') {
    return badRequest('durationMinutes/missing')
  }
  if (typeof raw.tariffId !== 'string') {
    return badRequest('tariffId/missing')
  }
  const notes =
    raw.notes === null
      ? null
      : typeof raw.notes === 'string'
        ? raw.notes
        : undefined

  const input: AssignSlotDirectInput = {
    teacherAccountId: guard.account.id, // bound to session
    learnerAccountId: raw.learnerAccountId,
    startAt: raw.startAt,
    durationMinutes: raw.durationMinutes,
    tariffId: raw.tariffId,
    notes,
  }

  const result = await assignSlotDirect(input)
  if (!result.ok) {
    return NextResponse.json(
      {
        error: result.reason,
        ...(result.availablePackages
          ? { availablePackages: result.availablePackages }
          : {}),
      },
      { status: statusForReason(result.reason), headers: NO_STORE },
    )
  }

  // Sub-PR B will wire email-notify here (rate-limited, fire-and-forget).
  // For Sub-PR A we return slot + billing; UI is not yet shipped, so the
  // endpoint is reachable only via the test harness.

  return NextResponse.json(
    {
      slot: result.slot,
      billing: result.billing,
      emailSkipped: result.emailSkipped,
    },
    { status: 201, headers: NO_STORE },
  )
}

function badRequest(code: string) {
  return NextResponse.json(
    { error: code },
    { status: 400, headers: NO_STORE },
  )
}

function statusForReason(reason: string): number {
  switch (reason) {
    case 'learner_not_assigned':
    case 'tariff_not_owned':
    case 'self_booking_blocked':
      return 403
    case 'tariff_not_active':
    case 'tariff_duration_mismatch':
    case 'in_past':
    case 'start_out_of_band':
    case 'start_not_30min_aligned':
    case 'no_package_no_postpaid':
    case 'payment_method_not_set':
      return 422
    case 'slot_collision':
    case 'external_conflict':
    case 'pending_package_grant':
      return 409
    default:
      return 500
  }
}
