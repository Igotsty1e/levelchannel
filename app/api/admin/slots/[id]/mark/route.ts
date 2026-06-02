import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { readJsonObjectOr400 } from '@/lib/api/json-body'
import { requireAdminRole } from '@/lib/auth/guards'
import {
  type SlotLifecycleStatus,
  LIFECYCLE_STATUSES,
  markSlotLifecycle,
} from '@/lib/scheduling/slots'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
} from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ALLOWED = new Set<SlotLifecycleStatus>(LIFECYCLE_STATUSES)

type RouteParams = { params: Promise<{ id: string }> }

// POST /api/admin/slots/[id]/mark { status: lifecycle }
//
// Stamps a lifecycle status (completed / no_show_*) on a booked slot
// whose start_at is already in the past. Refuses on:
//   - row not found (404)
//   - row not in `booked` state (400 — operator probably intended to
//     edit the existing lifecycle stamp; they need to cancel + recreate
//     instead, since lifecycle is one-shot in this wave)
//   - row whose start_at hasn't passed yet (400)

export async function POST(request: Request, { params }: RouteParams) {
  const { id } = await params

  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate

  const rl = await enforceRateLimit(request, 'admin:slots:ip', 30, 60_000)
  if (rl) return rl

  const guard = await requireAdminRole(request)
  if (!guard.ok) return guard.response

  const parsed = await readJsonObjectOr400(request)
  if (!parsed.ok) return parsed.response
  const status =
    typeof parsed.body.status === 'string' ? parsed.body.status : ''
  if (!ALLOWED.has(status as SlotLifecycleStatus)) {
    return NextResponse.json(
      {
        error:
          'status must be one of: completed, no_show_learner, no_show_teacher',
      },
      { status: 400, headers: NO_STORE },
    )
  }

  const result = await markSlotLifecycle(
    id,
    status as SlotLifecycleStatus,
    guard.account.id,
  )
  if (result.ok) {
    return NextResponse.json({ slot: result.slot }, { status: 200, headers: NO_STORE })
  }
  if (result.reason === 'not_found') {
    return NextResponse.json(
      { error: 'not_found', message: 'Слот не найден.' },
      { status: 404, headers: NO_STORE },
    )
  }
  if (result.reason === 'not_booked') {
    return NextResponse.json(
      { error: 'not_booked', message: 'Можно отметить только booked-слот.' },
      { status: 400, headers: NO_STORE },
    )
  }
  // SAAS-PIVOT Day 5A — surface from the markLessonCompleted anti-
  // spoof gate. Admin path passes the slot's own teacher_account_id
  // so this branch is mostly defensive (concurrent UPDATE on the
  // teacher_account_id between the helper's lookup and the eligibility
  // check, etc.).
  if (result.reason === 'wrong_teacher') {
    return NextResponse.json(
      { error: 'wrong_teacher', message: 'Учитель слота не совпадает.' },
      { status: 400, headers: NO_STORE },
    )
  }
  // 2026-06-02 — markLessonCompleted now surfaces a hard error when
  // a tariffed slot has NULL snapshot_amount_kopecks (trigger / backfill
  // contract bug). Operator-facing message: ask them to escalate to
  // engineering — this is not a user-actionable failure.
  if (result.reason === 'missing_snapshot') {
    return NextResponse.json(
      {
        error: 'missing_snapshot',
        message:
          'Не удалось отметить слот: у него выставлен тариф, но снимок цены пуст. Сообщите разработке (slot id в логах).',
      },
      { status: 500, headers: NO_STORE },
    )
  }
  // not_yet_started
  return NextResponse.json(
    {
      error: 'not_yet_started',
      message: 'Слот ещё не начался — отметить можно после start_at.',
    },
    { status: 400, headers: NO_STORE },
  )
}
