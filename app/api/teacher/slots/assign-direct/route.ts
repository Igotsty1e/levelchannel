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
import { getAccountById } from '@/lib/auth/accounts'
import { formatProfileNameForRender } from '@/lib/auth/profile-name'
import { getAccountProfile } from '@/lib/auth/profiles'
import { requireTeacherWithCurrentSaasOfferConsent } from '@/lib/auth/guards'
import { sendLearnerDirectAssignNoticeEmail } from '@/lib/email/dispatch'
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

  // Email notification — anti-spam: per-learner rate-limit (5/hour).
  // On limit-hit we don't fail the request; slot уже создан. UI получает
  // emailSkipped=true и может показать operator-friendly hint.
  let emailSkipped = false
  const emailRl = await enforceRateLimit(
    request,
    `learner-direct-assign-notice:${input.learnerAccountId}`,
    5,
    60 * 60_000,
  )
  if (emailRl) {
    emailSkipped = true
  } else {
    // Best-effort fire-and-forget. Resend outage не должна ломать ответ.
    try {
      const [learnerAcc, learnerProfile, teacherProfile] = await Promise.all([
        getAccountById(input.learnerAccountId),
        getAccountProfile(input.learnerAccountId),
        getAccountProfile(input.teacherAccountId),
      ])
      if (learnerAcc?.email) {
        const teacherName = teacherProfile
          ? formatProfileNameForRender({
              firstName: teacherProfile.firstName ?? null,
              lastName: teacherProfile.lastName ?? null,
              displayName: teacherProfile.displayName ?? null,
              fallbackEmail: '',
            })
          : null
        const learnerName = learnerProfile
          ? formatProfileNameForRender({
              firstName: learnerProfile.firstName ?? null,
              lastName: learnerProfile.lastName ?? null,
              displayName: learnerProfile.displayName ?? null,
              fallbackEmail: '',
            })
          : null
        await sendLearnerDirectAssignNoticeEmail(learnerAcc.email, {
          teacherDisplayName: teacherName && teacherName.length > 0 ? teacherName : null,
          startAt: new Date(result.slot.startAt),
          durationMinutes: result.slot.durationMinutes,
          learnerTimezone: learnerProfile?.timezone ?? null,
          learnerDisplayName: learnerName && learnerName.length > 0 ? learnerName : null,
        })
      } else {
        emailSkipped = true
      }
    } catch (_err) {
      emailSkipped = true
    }
  }

  return NextResponse.json(
    {
      slot: result.slot,
      billing: result.billing,
      emailSkipped,
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
