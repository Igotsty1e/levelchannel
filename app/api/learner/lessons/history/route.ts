// GET /api/learner/lessons/history
//
// 2026-06-17 — учетная история занятий с фильтрами. Аналог
// /api/teacher/lessons/history. Privacy: WHERE learner_account_id =
// session.id всегда.

import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import {
  listLearnerLessonHistory,
  type LearnerLessonHistoryFilter,
} from '@/lib/scheduling/slots'
import { lookupSession, SESSION_COOKIE_NAME } from '@/lib/auth/sessions'
import { cookies } from 'next/headers'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
} from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ALLOWED_STATUS = new Set<NonNullable<LearnerLessonHistoryFilter['status']>>([
  'completed',
  'no_show_learner',
  'no_show_teacher',
  'cancelled',
  'booked',
])

export async function GET(request: Request) {
  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate
  const rl = await enforceRateLimit(
    request,
    'learner:lessons:history:ip',
    60,
    60_000,
  )
  if (rl) return rl

  const cookieStore = await cookies()
  const cookieValue = cookieStore.get(SESSION_COOKIE_NAME)?.value ?? null
  if (!cookieValue) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE })
  }
  const session = await lookupSession(cookieValue)
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE })
  }

  const url = new URL(request.url)
  const filter: LearnerLessonHistoryFilter = {}

  const from = url.searchParams.get('from')
  if (from && !Number.isNaN(Date.parse(from))) filter.fromIso = from
  const to = url.searchParams.get('to')
  if (to && !Number.isNaN(Date.parse(to))) filter.toIso = to

  const status = url.searchParams.get('status')
  if (status && ALLOWED_STATUS.has(status as LearnerLessonHistoryFilter['status'] & string)) {
    filter.status = status as LearnerLessonHistoryFilter['status']
  }

  if (url.searchParams.get('unpaid') === '1') filter.unpaidOnly = true

  const limitRaw = url.searchParams.get('limit')
  filter.limit = limitRaw
    ? Math.min(Math.max(parseInt(limitRaw, 10) || 100, 1), 500)
    : 100

  const rows = await listLearnerLessonHistory(session.account.id, filter)
  return NextResponse.json(
    { rows, limit: filter.limit },
    { status: 200, headers: NO_STORE },
  )
}
