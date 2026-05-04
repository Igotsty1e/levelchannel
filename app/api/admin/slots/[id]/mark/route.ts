import { NextResponse } from 'next/server'

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

const noStore = { 'Cache-Control': 'no-store, max-age=0' }
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

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body.' },
      { status: 400, headers: noStore },
    )
  }
  const status =
    typeof body === 'object' &&
    body !== null &&
    typeof (body as Record<string, unknown>).status === 'string'
      ? ((body as Record<string, unknown>).status as string)
      : ''
  if (!ALLOWED.has(status as SlotLifecycleStatus)) {
    return NextResponse.json(
      {
        error:
          'status must be one of: completed, no_show_learner, no_show_teacher',
      },
      { status: 400, headers: noStore },
    )
  }

  const result = await markSlotLifecycle(
    id,
    status as SlotLifecycleStatus,
    guard.account.id,
  )
  if (result.ok) {
    return NextResponse.json({ slot: result.slot }, { status: 200, headers: noStore })
  }
  if (result.reason === 'not_found') {
    return NextResponse.json(
      { error: 'Слот не найден.' },
      { status: 404, headers: noStore },
    )
  }
  if (result.reason === 'not_booked') {
    return NextResponse.json(
      { error: 'Можно отметить только booked-слот.' },
      { status: 400, headers: noStore },
    )
  }
  // not_yet_started
  return NextResponse.json(
    { error: 'Слот ещё не начался — отметить можно после start_at.' },
    { status: 400, headers: noStore },
  )
}
