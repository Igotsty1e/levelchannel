// GET /api/teacher/lessons/recent-past?limit=5
//
// Wave-2 lesson-history (2026-06-16). Возвращает 1-50 последних
// прошедших booked-слотов учителя БЕЗ completion-row. Для карточки
// «Недавние прошедшие» на главной /teacher.
//
// Privacy: scope ON `teacher_account_id = session.id` (см.
// listRecentPastUnmarkedSlots).

import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { requireTeacherWithCurrentSaasOfferConsent } from '@/lib/auth/guards'
import { listRecentPastUnmarkedSlots } from '@/lib/scheduling/slots'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
} from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate
  const rl = await enforceRateLimit(
    request,
    'teacher:lessons:recent-past:ip',
    60,
    60_000,
  )
  if (rl) return rl
  const guard = await requireTeacherWithCurrentSaasOfferConsent(request)
  if (!guard.ok) return guard.response

  const url = new URL(request.url)
  const limitRaw = url.searchParams.get('limit')
  const limit = limitRaw ? Math.min(Math.max(parseInt(limitRaw, 10) || 5, 1), 50) : 5

  const slots = await listRecentPastUnmarkedSlots(guard.account.id, limit)
  return NextResponse.json(
    { slots },
    { status: 200, headers: NO_STORE },
  )
}
