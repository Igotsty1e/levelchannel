import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { listAccountRoles } from '@/lib/auth/accounts'
import { getCurrentSession } from '@/lib/auth/sessions'
import {
  getActiveTeacherForLearner,
  getActiveTeacherIdsForLearner,
} from '@/lib/auth/teacher-scope'
import { listOpenFutureSlots, toPublicSlot } from '@/lib/scheduling/slots'
import { enforceRateLimit } from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'


// GET /api/slots/available?teacher=<uuid>&from=<iso>&to=<iso>
//
// Behaviour:
//   - Authenticated learner: filter is FORCED to their
//     `assigned_teacher_id`. Any `?teacher=` query param is ignored.
//     Codex 2026-05-08 — pre-fix, the query param overrode the
//     session-derived filter, letting a learner browse arbitrary
//     teachers' slots (including a different learner's assigned
//     teacher's roster). Now the session is the trust anchor; the
//     query param is decorative for this caller class.
//   - Anonymous (no session): caller may pass `?teacher=<uuid>` for
//     explicit filter, otherwise gets all open slots. Anonymous
//     "browse all open slots" is the existing loose contract — used
//     by the public marketing surface to render "available lessons"
//     widgets.
//   - Both paths return the public DTO. Codex 2026-05-08 — pre-fix,
//     authenticated callers got the full LessonSlot shape including
//     teacher_email and internal account IDs; the cabinet UI does
//     not need those, and exposing them on a learner-readable
//     endpoint is unnecessary leakage.
//   - Authenticated admin/teacher → 403 (wrong role; this is the
//     learner-browse endpoint).

export async function GET(request: Request) {
  const rl = await enforceRateLimit(request, 'slots:available:ip', 60, 60_000)
  if (rl) return rl

  const url = new URL(request.url)
  const teacherFromQuery = url.searchParams.get('teacher')
  const from = url.searchParams.get('from')
  const to = url.searchParams.get('to')

  const session = await getCurrentSession(request)

  // Wave 1 (security) — elevated roles are not learners; this is the
  // learner-browse endpoint. Block authenticated admin/teacher from
  // calling it. Anonymous browsing stays open per the comment above.
  if (session) {
    const roles = await listAccountRoles(session.account.id)
    if (roles.includes('admin') || roles.includes('teacher')) {
      return NextResponse.json(
        {
          error: 'wrong_role',
          message: 'Эта операция доступна только ученикам.',
        },
        { status: 403, headers: NO_STORE },
      )
    }
  }

  let teacherFilter: string | null | undefined
  if (session) {
    // SAAS-PIVOT Day 2 (2026-05-22) — n:m teacher context (plan §2.5).
    // The pivot promotes a learner's assigned-teacher binding from a
    // single value to an n:m membership in learner_teacher_links.
    //   - single active link → that teacher's id; ignore ?teacher= override.
    //   - multiple active links → require an explicit ?teacher=<id>
    //     query param validated against the learner's link set.
    //     Without it, 400 needs_teacher_picker so the client renders a
    //     teacher chooser.
    //   - zero active links → empty list (legacy behaviour preserved).
    const resolved = await getActiveTeacherForLearner(session.account.id)
    if (resolved.needsPicker) {
      // Multi-link learner. Validate ?teacher=<id> against the
      // learner's active link set; never trust a client-supplied
      // teacher id as-is.
      if (!teacherFromQuery) {
        return NextResponse.json(
          {
            error: 'needs_teacher_picker',
            message:
              'У вас несколько учителей. Укажите учителя через параметр ?teacher=<id>.',
          },
          { status: 400, headers: NO_STORE },
        )
      }
      const allowed = await getActiveTeacherIdsForLearner(session.account.id)
      if (!allowed.includes(teacherFromQuery)) {
        return NextResponse.json(
          {
            error: 'needs_teacher_picker',
            message: 'Этот учитель не привязан к вашему аккаунту.',
          },
          { status: 400, headers: NO_STORE },
        )
      }
      teacherFilter = teacherFromQuery
    } else if (resolved.teacherId === null) {
      // Logged-in learner with no assigned teacher → empty list,
      // cabinet surfaces the «учитель не назначен» hint.
      return NextResponse.json(
        { slots: [] },
        { status: 200, headers: NO_STORE },
      )
    } else {
      teacherFilter = resolved.teacherId
    }
  } else {
    // Anonymous: explicit query filter (or null = all teachers).
    teacherFilter = teacherFromQuery
  }

  const slots = await listOpenFutureSlots({
    teacherAccountId: teacherFilter,
    fromIso: from ?? undefined,
    toIso: to ?? undefined,
  })

  // Both anonymous and authenticated learners receive the public DTO.
  // Internal fields (teacher email, internal account IDs, notes,
  // lifecycle audit fields, scheduling timestamps) stay server-side.
  return NextResponse.json(
    { slots: slots.map(toPublicSlot) },
    { status: 200, headers: NO_STORE },
  )
}
