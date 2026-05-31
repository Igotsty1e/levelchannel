import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { requireTeacherWithCurrentSaasOfferConsent } from '@/lib/auth/guards'
import { listHiddenSlotsForTeacher } from '@/lib/calendar/hidden-slots'
import { enforceRateLimit } from '@/lib/security/request'

// BCS-G.2 — GET /api/teacher/hidden-slots
//
// Plan §4.10 surface. Returns the teacher's own OPEN, future slots
// that overlap a busy interval the teacher's Google Calendar pulled
// in. These are the slots the learner-side pre-book filter is
// silently hiding from the booking calendar. Read-only; mutations
// (cancel/move) go through the existing teacher slot routes.
//
// Auth: requireTeacherWithCurrentSaasOfferConsent — the surface is meaningless for
// non-teacher accounts, and the verified gate matches the rest of
// the teacher API set.
//
// Bounded by 30-day window inside the helper (matches the
// `teacher_external_busy_intervals` retention + pull window). The
// optional `from` query param is documented in the plan but is a
// no-op in this PR — the hidden-slot list is small enough that
// pagination isn't needed; subset filters can land alongside the
// drilldown UI if the volume justifies it.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const rl = await enforceRateLimit(
    request,
    'teacher:hidden-slots:ip',
    60,
    60_000,
  )
  if (rl) return rl

  const guard = await requireTeacherWithCurrentSaasOfferConsent(request)
  if (!guard.ok) return guard.response

  const slots = await listHiddenSlotsForTeacher({
    teacherAccountId: guard.account.id,
  })

  return NextResponse.json({ slots }, { headers: NO_STORE })
}
