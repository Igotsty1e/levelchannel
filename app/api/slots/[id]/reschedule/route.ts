// POST /api/slots/[id]/reschedule
//
// teacher-no-slots-mode (Задача 2.1, Sub-PR B, 2026-06-11).
// Learner moves their own booked slot to a new start_at. Semantics =
// cancel original + create new booked slot with the SAME teacher /
// tariff / duration. Both arms in one TX + per-learner advisory lock
// (no double-consume / loss-of-unit race).
//
// Body: { newStartAt: ISO-8601 string }
//
// Cancel-window applies (`LEARNER_CANCEL_WINDOW_HOURS`, default 24h)
// — same gate as `cancelLearnerSlot`.

import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { readJsonObjectOr400 } from '@/lib/api/json-body'
import { requireLearnerArchetype } from '@/lib/auth/guards'
import { rescheduleSlotByLearner } from '@/lib/scheduling/slots'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
} from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteParams = { params: Promise<{ id: string }> }

export async function POST(request: Request, { params }: RouteParams) {
  const { id } = await params

  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate

  const rl = await enforceRateLimit(request, 'slots:reschedule:ip', 30, 60_000)
  if (rl) return rl

  const auth = await requireLearnerArchetype(request)
  if (!auth.ok) return auth.response

  const parsed = await readJsonObjectOr400(request, { coded: true })
  if (!parsed.ok) return parsed.response

  if (typeof parsed.body.newStartAt !== 'string') {
    return NextResponse.json(
      { error: 'newStartAt/missing' },
      { status: 400, headers: NO_STORE },
    )
  }

  const result = await rescheduleSlotByLearner(
    id,
    auth.account.id,
    parsed.body.newStartAt,
  )

  if (!result.ok) {
    const status = statusForReason(result.reason)
    return NextResponse.json(
      {
        error: result.reason,
        ...(result.minutesUntilStart !== undefined
          ? { minutesUntilStart: result.minutesUntilStart }
          : {}),
      },
      { status, headers: NO_STORE },
    )
  }

  return NextResponse.json(
    { oldSlot: result.oldSlot, newSlot: result.newSlot },
    { status: 200, headers: NO_STORE },
  )
}

function statusForReason(reason: string): number {
  switch (reason) {
    case 'not_found':
      return 404
    case 'not_owner':
      return 403
    case 'already_terminal':
    case 'too_late_to_reschedule':
    case 'in_past':
    case 'start_out_of_band':
    case 'start_not_30min_aligned':
      return 422
    case 'slot_collision':
    case 'external_conflict':
      return 409
    default:
      return 500
  }
}
