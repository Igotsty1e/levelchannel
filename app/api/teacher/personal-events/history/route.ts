// Epic B (2026-06-19) — GET /api/teacher/personal-events/history.
// Возвращает список дел учителя (active + terminal) для рендера в
// /teacher/lessons таб «Дела».

import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { requireTeacherWithCurrentSaasOfferConsent } from '@/lib/auth/guards'
import { listPersonalEventsForTeacher } from '@/lib/scheduling/slots'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const guard = await requireTeacherWithCurrentSaasOfferConsent(request)
  if (!guard.ok) return guard.response
  const rows = await listPersonalEventsForTeacher(guard.account.id, {
    limit: 200,
    includeTerminal: true,
  })
  return NextResponse.json(
    {
      rows: rows.map((s) => ({
        id: s.id,
        startAt: s.startAt,
        durationMinutes: s.durationMinutes,
        status: s.status,
        title: s.personalEventTitle ?? '',
        body: s.personalEventBody ?? null,
        // teacher-lessons-edit-status epic (2026-06-24) — для kebab UI.
        // Деla не billable; canEdit всегда true. updatedAt → 409 stale check.
        updatedAt: s.updatedAt,
      })),
    },
    { headers: NO_STORE },
  )
}
