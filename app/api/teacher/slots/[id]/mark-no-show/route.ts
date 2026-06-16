// POST /api/teacher/slots/[id]/mark-no-show
//
// Wave-2 lesson-history (2026-06-16). Teacher отмечает прошедший booked
// слот как «ученик не пришёл» (`was_no_show=true`). Делегируем в
// `markSlotByTeacher` (`status='no_show_learner'`) с pre-ownership check,
// после успеха диспетчим Wave-A `LessonMarkedNoShowByTeacher`.

import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { requireTeacherWithCurrentSaasOfferConsent } from '@/lib/auth/guards'
import { dispatchLessonEvent } from '@/lib/notifications/lesson-event-dispatch'
import { getActorDisplayName } from '@/lib/notifications/recipient-resolver'
import { markSlotByTeacher } from '@/lib/scheduling/slots'
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
  const rl = await enforceRateLimit(
    request,
    'teacher:slots:mark-no-show:ip',
    30,
    60_000,
  )
  if (rl) return rl
  const guard = await requireTeacherWithCurrentSaasOfferConsent(request)
  if (!guard.ok) return guard.response

  const result = await markSlotByTeacher(id, guard.account.id, 'no_show_learner')
  if (!result.ok) {
    return errorResponse(result.reason)
  }

  if (result.recipientAccountId) {
    try {
      const actorName = await getActorDisplayName(guard.account.id)
      await dispatchLessonEvent('LessonMarkedNoShowByTeacher', {
        slotId: result.slot.id,
        recipientAccountId: result.recipientAccountId,
        recipientRole: 'learner',
        iterSeq: 1,
        payload: {
          actorDisplayName: actorName,
          recipientDisplayName: '',
          slotStartAtIso: result.slot.startAt,
          durationMinutes: result.slot.durationMinutes,
        },
      })
    } catch (err) {
      console.error('[mark-no-show] dispatch failed', err)
    }
  }

  return NextResponse.json(
    { slot: result.slot },
    { status: 200, headers: NO_STORE },
  )
}

function errorResponse(reason: string) {
  switch (reason) {
    case 'not_found':
      return NextResponse.json(
        { error: 'not_found' },
        { status: 404, headers: NO_STORE },
      )
    case 'not_owner':
      return NextResponse.json(
        { error: 'not_owner', message: 'Этот слот не принадлежит вам.' },
        { status: 403, headers: NO_STORE },
      )
    case 'not_booked':
      return NextResponse.json(
        { error: 'not_booked', message: 'Можно отметить только забронированное прошедшее занятие.' },
        { status: 409, headers: NO_STORE },
      )
    case 'not_yet_started':
      return NextResponse.json(
        { error: 'not_yet_started', message: 'Занятие ещё не началось.' },
        { status: 422, headers: NO_STORE },
      )
    case 'missing_snapshot':
      return NextResponse.json(
        { error: 'missing_snapshot', message: 'У слота нет тарифного снимка.' },
        { status: 422, headers: NO_STORE },
      )
    default:
      return NextResponse.json(
        { error: 'internal_error' },
        { status: 500, headers: NO_STORE },
      )
  }
}
