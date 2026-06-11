// GET /api/teacher/learners/list-for-assign
//
// teacher-direct-assign (Задача 2.2, Sub-PR B, 2026-06-11). JSON
// payload для Combobox в форме «Назначить ученику». Возвращает только
// активно-привязанных учеников (`learner_teacher_links.unlinked_at IS
// NULL`), sorted by display name.
//
// Trust boundary: teacher session bound; learner list scoped to this
// teacher only — no cross-teacher leak.

import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { requireTeacherWithCurrentSaasOfferConsent } from '@/lib/auth/guards'
import { listLearnersForTeacher } from '@/lib/scheduling/teacher-learners'
import { enforceRateLimit } from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const rl = await enforceRateLimit(
    request,
    'teacher:learners-list-for-assign:ip',
    60,
    60_000,
  )
  if (rl) return rl

  const guard = await requireTeacherWithCurrentSaasOfferConsent(request)
  if (!guard.ok) return guard.response

  const rows = await listLearnersForTeacher(guard.account.id)
  // Filter to active link only (listLearnersForTeacher returns historical
  // entries too — see lib/scheduling/teacher-learners.ts comments).
  const filtered = rows.filter((r) => r.isAssigned)
  const items = filtered.map((r) => ({
    learnerId: r.learnerId,
    learnerEmail: r.learnerEmail,
    displayName: r.displayName,
    firstName: r.firstName ?? null,
    lastName: r.lastName ?? null,
    paymentMethod: r.paymentMethod,
  }))

  return NextResponse.json({ items }, { status: 200, headers: NO_STORE })
}
