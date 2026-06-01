import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { requireLearnerArchetypeAndVerified } from '@/lib/auth/guards'
import { getAccountProfile } from '@/lib/auth/profiles'
import {
  getActiveTeacherForLearner,
  getActiveTeacherIdsForLearner,
} from '@/lib/auth/teacher-scope'
import { safeTimezone } from '@/lib/auth/timezones'
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
  const teacherFromQuery = url.searchParams.get('teacher')

  if (!ymd || !isValidYmd(ymd)) {
    return NextResponse.json(
      { error: 'invalid_ymd', message: '`ymd` must be a real YYYY-MM-DD date' },
      { status: 400, headers: NO_STORE },
    )
  }

  const profile = await getAccountProfile(auth.account.id)
  // BUG fix 2026-05-15 — see booking-days/route.ts. Legacy profile
  // values like 'Moscow' get clamped to Europe/Moscow; explicit
  // client-supplied `?tz=` stays raw so the invalid_tz response below
  // surfaces caller-side bugs clearly.
  const tz = tzParam ?? safeTimezone(profile?.timezone)
  if (!isValidIanaTz(tz)) {
    return NextResponse.json(
      { error: 'invalid_tz', message: '`tz` must be a valid IANA timezone' },
      { status: 400, headers: NO_STORE },
    )
  }

  // SAAS-PIVOT Day 2 (2026-05-22) — n:m teacher context (plan §2.5).
  const resolved = await getActiveTeacherForLearner(auth.account.id)
  let teacherId: string | null
  if (resolved.needsPicker) {
    if (!teacherFromQuery) {
      return NextResponse.json(
        {
          error: 'needs_teacher_picker',
          message:
            'У вас несколько учителей. Укажите учителя через параметр ?teacher=<id>.',
        },
        { status: 400, headers: NO_STORE },
      )
    }
    const allowed = await getActiveTeacherIdsForLearner(auth.account.id)
    if (!allowed.includes(teacherFromQuery)) {
      return NextResponse.json(
        {
          error: 'needs_teacher_picker',
          message: 'Этот учитель не привязан к вашему аккаунту.',
        },
        { status: 400, headers: NO_STORE },
      )
    }
    teacherId = teacherFromQuery
  } else {
    teacherId = resolved.teacherId
  }

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
    // T3 epic-end R1-BLOCKER#2: viewer for visibility filter.
    viewerAccountId: auth.account.id,
  })

  return NextResponse.json(
    { slots: slots.map(toPublicSlot) },
    { status: 200, headers: NO_STORE },
  )
}
