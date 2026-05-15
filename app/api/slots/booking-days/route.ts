import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { requireLearnerArchetypeAndVerified } from '@/lib/auth/guards'
import { getAccountProfile } from '@/lib/auth/profiles'
import { safeTimezone } from '@/lib/auth/timezones'
import {
  listOpenBookingDays,
  validateBookingRange,
} from '@/lib/scheduling/slots'
import { enforceRateLimit } from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/slots/booking-days?from=YYYY-MM-DD&to=YYYY-MM-DD&tz=Europe/Moscow
//
// Returns the list of YYYY-MM-DD calendar days within the requested
// range that hold ≥1 OPEN, future slot belonging to the caller's
// assigned teacher. Powers the Calendly screen-1 day picker (BCS-B).
//
// Auth: learner archetype + verified email. Admin / teacher → 403
// (this is a learner-only surface; operator UIs use /api/admin/slots
// and /api/slots/calendar respectively).
//
// Teacher filter: forced to `session.account.assignedTeacherId`. The
// learner cannot browse other teachers' availability — there is no
// marketplace in MVP.
//
// Timezone: `tz` query param, default = learner's profile tz, fallback
// `Europe/Moscow`. Day grouping happens in Postgres via `AT TIME ZONE`
// against the timestamptz `start_at` column.
//
// Range bound: at most 92 days (`MAX_DAYS_RANGE_DAYS` in
// booking-queries.ts) — guard against runaway queries.

export async function GET(request: Request) {
  const rl = await enforceRateLimit(
    request,
    'slots:booking-days:ip',
    60,
    60_000,
  )
  if (rl) return rl

  const auth = await requireLearnerArchetypeAndVerified(request)
  if (!auth.ok) return auth.response

  const url = new URL(request.url)
  const fromYmd = url.searchParams.get('from')
  const toYmd = url.searchParams.get('to')
  const tzParam = url.searchParams.get('tz')

  const profile = await getAccountProfile(auth.account.id)
  // BUG fix 2026-05-15 — sanitise legacy profile values like 'Moscow'
  // (non-IANA) which would otherwise fall through validateBookingRange
  // and 400 the caller. Client-supplied `?tz=` is left raw so a bad
  // value still produces a clean `invalid_tz` error message.
  const tz = tzParam ?? safeTimezone(profile?.timezone)

  const error = validateBookingRange({ fromYmd, toYmd, tz })
  if (error) {
    return NextResponse.json(
      { error: error.code, message: error.message },
      { status: 400, headers: NO_STORE },
    )
  }

  const teacherId = auth.account.assignedTeacherId
  if (!teacherId) {
    return NextResponse.json(
      { days: [] },
      { status: 200, headers: NO_STORE },
    )
  }

  const days = await listOpenBookingDays({
    teacherAccountId: teacherId,
    fromYmd: fromYmd!,
    toYmd: toYmd!,
    tz,
  })

  return NextResponse.json(
    { days },
    { status: 200, headers: NO_STORE },
  )
}
