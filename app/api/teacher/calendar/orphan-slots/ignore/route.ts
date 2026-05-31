import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { readJsonObjectOr400 } from '@/lib/api/json-body'
import { requireTeacherWithCurrentSaasOfferConsent } from '@/lib/auth/guards'
import {
  ignoreAllOrphanSelfSlotsForTeacher,
  ignoreOrphanSelfSlot,
} from '@/lib/calendar/orphan-cleanup'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
} from '@/lib/security/request'

// BCS-G.4 — POST /api/teacher/calendar/orphan-slots/ignore
//
// Bulk action — null the stale binding on either a single slot id
// (body: { slotId: '<uuid>' }) or all orphan-self rows for the
// session teacher (body: { all: true }). NULL-s
// external_calendar_id, external_event_id, integration_epoch.
// Does NOT touch Google (the orphan event belongs to the previous
// integration session; the teacher manages it from their own
// calendar UI — see plan §4.12).

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate

  const rl = await enforceRateLimit(
    request,
    'teacher:orphan-slots-ignore:ip',
    20,
    60_000,
  )
  if (rl) return rl

  const guard = await requireTeacherWithCurrentSaasOfferConsent(request)
  if (!guard.ok) return guard.response

  const parsed = await readJsonObjectOr400(request, { coded: true })
  if (!parsed.ok) return parsed.response
  const body = parsed.body

  if (body.all === true) {
    const r = await ignoreAllOrphanSelfSlotsForTeacher(guard.account.id)
    return NextResponse.json({ ignored: r.ignored }, { headers: NO_STORE })
  }

  if (typeof body.slotId !== 'string') {
    return NextResponse.json(
      {
        error: 'invalid_body',
        message: 'Provide either `all: true` or `slotId: <uuid>`.',
      },
      { status: 400, headers: NO_STORE },
    )
  }
  const r = await ignoreOrphanSelfSlot({
    teacherAccountId: guard.account.id,
    slotId: body.slotId,
  })
  if (!r.ok) {
    return NextResponse.json(
      { error: 'not_found', message: 'No orphan-self slot matched.' },
      { status: 404, headers: NO_STORE },
    )
  }
  return NextResponse.json({ ignored: r.ignored }, { headers: NO_STORE })
}
