// GET /api/teacher/lessons/history
//
// Wave-2 lesson-history (2026-06-16). Возвращает paginated past
// занятия учителя с фильтрами: period (from/to), learnerId, status,
// unmarkedOnly. Для страницы /teacher/lessons.
//
// Query params:
//   - from, to: ISO timestamp (фильтрация по start_at)
//   - learnerId: UUID
//   - status: completed | no_show_learner | no_show_teacher | cancelled | booked
//   - unmarked: '1' → только booked-в-прошлом без completion row
//   - limit: 1-200 (default 50)
//   - offset: ≥0 (default 0)

import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { requireTeacherWithCurrentSaasOfferConsent } from '@/lib/auth/guards'
import {
  listLessonHistory,
  type LessonHistoryFilter,
} from '@/lib/scheduling/slots'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
} from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ALLOWED_STATUS = new Set<NonNullable<LessonHistoryFilter['status']>>([
  'completed',
  'no_show_learner',
  'no_show_teacher',
  'cancelled',
  'booked',
])

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(request: Request) {
  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate
  const rl = await enforceRateLimit(
    request,
    'teacher:lessons:history:ip',
    60,
    60_000,
  )
  if (rl) return rl
  const guard = await requireTeacherWithCurrentSaasOfferConsent(request)
  if (!guard.ok) return guard.response

  const url = new URL(request.url)
  const filter: LessonHistoryFilter = {}

  const from = url.searchParams.get('from')
  if (from && !Number.isNaN(Date.parse(from))) filter.fromIso = from
  const to = url.searchParams.get('to')
  if (to && !Number.isNaN(Date.parse(to))) filter.toIso = to

  const learnerId = url.searchParams.get('learnerId')
  if (learnerId && UUID_PATTERN.test(learnerId)) {
    filter.learnerAccountId = learnerId
  }

  const status = url.searchParams.get('status')
  if (status && ALLOWED_STATUS.has(status as LessonHistoryFilter['status'] & string)) {
    filter.status = status as LessonHistoryFilter['status']
  }

  if (url.searchParams.get('unmarked') === '1') filter.unmarkedOnly = true

  const limitRaw = url.searchParams.get('limit')
  const offsetRaw = url.searchParams.get('offset')
  filter.limit = limitRaw
    ? Math.min(Math.max(parseInt(limitRaw, 10) || 50, 1), 200)
    : 50
  filter.offset = offsetRaw ? Math.max(parseInt(offsetRaw, 10) || 0, 0) : 0

  const rows = await listLessonHistory(guard.account.id, filter)
  return NextResponse.json(
    { rows, limit: filter.limit, offset: filter.offset },
    { status: 200, headers: NO_STORE },
  )
}
