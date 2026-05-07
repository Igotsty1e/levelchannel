import { NextResponse } from 'next/server'

import { requireLearnerArchetype } from '@/lib/auth/guards'
import { cancelLearnerSlot } from '@/lib/scheduling/slots'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
} from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const noStore = { 'Cache-Control': 'no-store, max-age=0' }

type RouteParams = { params: Promise<{ id: string }> }

// POST /api/slots/[id]/cancel — learner cancels their own booking.
//
// Codex 2026-05-07 #3 — the previous implementation read the slot,
// evaluated the 24h rule in JS, then issued a wide UPDATE that
// allowed any status except 'cancelled' to flip. That left two TOCTOU
// windows AND let a `completed` / `no_show_*` row be retroactively
// rewritten as `cancelled`. The new flow folds ownership + booked-state
// + 24h cutoff into a single atomic UPDATE — `cancelLearnerSlot` is
// the security boundary; this route just maps the disambiguation to
// HTTP statuses.
//
// Operator-side cancel goes through /api/admin/slots/[id]/cancel and
// bypasses the 24h gate by design (admin override).

export async function POST(request: Request, { params }: RouteParams) {
  const { id } = await params

  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate

  const rl = await enforceRateLimit(request, 'slots:cancel:ip', 30, 60_000)
  if (rl) return rl

  const auth = await requireLearnerArchetype(request)
  if (!auth.ok) return auth.response

  let body: unknown = null
  try {
    body = await request.json()
  } catch {
    body = {}
  }
  const reason =
    typeof body === 'object' &&
    body !== null &&
    typeof (body as Record<string, unknown>).reason === 'string'
      ? ((body as Record<string, unknown>).reason as string)
      : null

  try {
    const result = await cancelLearnerSlot(id, auth.account.id, reason)
    if (result.ok) {
      return NextResponse.json(
        { slot: result.slot },
        { status: 200, headers: noStore },
      )
    }

    if (result.reason === 'not_found') {
      return NextResponse.json(
        { error: 'Slot not found.' },
        { status: 404, headers: noStore },
      )
    }
    if (result.reason === 'not_owner') {
      return NextResponse.json(
        { error: 'Можно отменить только своё бронирование.' },
        { status: 403, headers: noStore },
      )
    }
    if (result.reason === 'already_terminal') {
      return NextResponse.json(
        { error: 'already_terminal' },
        { status: 409, headers: noStore },
      )
    }
    // too_late_to_cancel
    return NextResponse.json(
      {
        error: 'too_late_to_cancel',
        minutesUntilStart: result.minutesUntilStart,
      },
      { status: 403, headers: noStore },
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    return NextResponse.json({ error: msg }, { status: 400, headers: noStore })
  }
}
