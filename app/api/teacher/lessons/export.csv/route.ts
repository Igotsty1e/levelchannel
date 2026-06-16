// GET /api/teacher/lessons/export.csv
//
// Wave-2 lesson-history (2026-06-16). CSV-экспорт past занятий учителя
// с теми же фильтрами что и `/history`. Cap 5000 строк (paranoia W-2).
//
// Privacy: scope ON `teacher_account_id = session.id`.

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

const CSV_HEADERS = [
  'slot_id',
  'start_at',
  'duration_min',
  'learner_id',
  'tariff_slug',
  'status',
  'is_marked',
  'amount_kopecks',
]

// CSV cell — экранируем " и оборачиваем в "..." если содержит ,\n"
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  const s = String(value)
  if (/[,"\n\r]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"'
  }
  return s
}

export async function GET(request: Request) {
  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate
  const rl = await enforceRateLimit(
    request,
    'teacher:lessons:export:ip',
    10,
    60_000,
  )
  if (rl) return rl
  const guard = await requireTeacherWithCurrentSaasOfferConsent(request)
  if (!guard.ok) return guard.response

  const url = new URL(request.url)
  const filter: LessonHistoryFilter = { limit: 5000 }
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

  const rows = await listLessonHistory(guard.account.id, filter)

  const lines: string[] = []
  lines.push(CSV_HEADERS.join(','))
  for (const row of rows) {
    lines.push(
      [
        csvCell(row.id),
        csvCell(row.startAt),
        csvCell(row.durationMinutes),
        csvCell(row.learnerAccountId ?? ''),
        csvCell(row.tariffSlug ?? ''),
        csvCell(row.status),
        csvCell(row.isMarked ? '1' : '0'),
        csvCell(row.tariffAmountKopecks ?? ''),
      ].join(','),
    )
  }
  const body = lines.join('\n')
  const filename = `lessons-history-${new Date().toISOString().slice(0, 10)}.csv`
  return new NextResponse(body, {
    status: 200,
    headers: {
      ...NO_STORE,
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
