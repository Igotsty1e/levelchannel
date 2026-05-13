import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { requireLearnerArchetypeAndVerified } from '@/lib/auth/guards'
import { getAccountProfile } from '@/lib/auth/profiles'
import {
  isValidIanaTz,
  isValidYmd,
  listOpenBookingTimes,
  toPublicSlot,
} from '@/lib/scheduling/slots'
import { enforceRateLimit } from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/slots/booking-times?ymd=YYYY-MM-DD&tz=Europe/Moscow
//
// Returns OPEN, future slots whose `start_at` falls within the given
// calendar day (in the provided tz) belonging to the caller's assigned
// teacher. Powers the Calendly screen-2 time list (BCS-B).
//
// Auth + teacher-filter rules: identical to booking-days.
//
// Response shape uses the PublicSlot projection — internal fields
// (teacher email, learner ids, notes, lifecycle audit timestamps) are
// not exposed to the learner-facing route. Same hygiene as
// /api/slots/available.

export async function GET(request: Request) {
  const rl = await enforceRateLimit(
    request,
    'slots:booking-times:ip',
    120,
    60_000,
  )
  if (rl) return rl

  const auth = await requireLearnerArchetypeAndVerified(request)
  if (!auth.ok) return auth.response

  const url = new URL(request.url)
  const ymd = url.searchParams.get('ymd')
  const tzParam = url.searchParams.get('tz')

  if (!ymd || !isValidYmd(ymd)) {
    return NextResponse.json(
      { error: 'invalid_ymd', message: '`ymd` must be a real YYYY-MM-DD date' },
      { status: 400, headers: NO_STORE },
    )
  }

  const profile = await getAccountProfile(auth.account.id)
  const tz = tzParam ?? profile?.timezone ?? 'Europe/Moscow'
  if (!isValidIanaTz(tz)) {
    return NextResponse.json(
      { error: 'invalid_tz', message: '`tz` must be a valid IANA timezone' },
      { status: 400, headers: NO_STORE },
    )
  }

  const teacherId = auth.account.assignedTeacherId
  if (!teacherId) {
    return NextResponse.json(
      { slots: [] },
      { status: 200, headers: NO_STORE },
    )
  }

  const slots = await listOpenBookingTimes({
    teacherAccountId: teacherId,
    ymd,
    tz,
  })

  return NextResponse.json(
    { slots: slots.map(toPublicSlot) },
    { status: 200, headers: NO_STORE },
  )
}
