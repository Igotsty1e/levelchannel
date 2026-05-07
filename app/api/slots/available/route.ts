import { NextResponse } from 'next/server'

import { listAccountRoles } from '@/lib/auth/accounts'
import { getCurrentSession } from '@/lib/auth/sessions'
import { listOpenFutureSlots } from '@/lib/scheduling/slots'
import { enforceRateLimit } from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const noStore = { 'Cache-Control': 'no-store, max-age=0' }

// GET /api/slots/available?teacher=<uuid>&from=<iso>&to=<iso>
//
// Default behaviour:
//   - if the request carries a session, return ONLY the open slots
//     of that learner's `assigned_teacher_id`. Unassigned → empty
//     list (cabinet renders the «учитель не назначен» hint).
//   - if anonymous (no session), no implicit filter — caller may
//     pass `?teacher=<uuid>` for explicit filter, otherwise gets all
//     open slots. Anonymous "browse all open slots" is the existing
//     loose contract; tightening it would break standalone browsing.
//   - explicit `?teacher=<uuid>` overrides the session-derived
//     filter (useful for operator browsing in the future).

export async function GET(request: Request) {
  const rl = await enforceRateLimit(request, 'slots:available:ip', 60, 60_000)
  if (rl) return rl

  const url = new URL(request.url)
  const teacherFromQuery = url.searchParams.get('teacher')
  const from = url.searchParams.get('from')
  const to = url.searchParams.get('to')

  let teacherFilter: string | null | undefined = teacherFromQuery
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
        { status: 403, headers: noStore },
      )
    }
  }

  if (!teacherFilter) {
    if (session) {
      const assigned = session.account.assignedTeacherId
      if (assigned) {
        teacherFilter = assigned
      } else {
        // Logged-in learner with no assigned teacher → return empty,
        // surface the hint in the cabinet.
        return NextResponse.json(
          { slots: [] },
          { status: 200, headers: noStore },
        )
      }
    }
  }

  const slots = await listOpenFutureSlots({
    teacherAccountId: teacherFilter,
    fromIso: from ?? undefined,
    toIso: to ?? undefined,
  })

  return NextResponse.json({ slots }, { status: 200, headers: noStore })
}
