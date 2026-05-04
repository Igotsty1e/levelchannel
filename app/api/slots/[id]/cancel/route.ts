import { NextResponse } from 'next/server'

import { requireAuthenticated } from '@/lib/auth/guards'
import { cancelSlot, getSlotById } from '@/lib/scheduling/slots'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
} from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const noStore = { 'Cache-Control': 'no-store, max-age=0' }

type RouteParams = { params: Promise<{ id: string }> }

// POST /api/slots/[id]/cancel — learner cancels their own booking.
// 24-hour rule is Phase 5 territory; this wave just stamps cancelled_at.
// Operator-side cancel goes through /api/admin/slots/[id]/cancel.

export async function POST(request: Request, { params }: RouteParams) {
  const { id } = await params

  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate

  const rl = await enforceRateLimit(request, 'slots:cancel:ip', 30, 60_000)
  if (rl) return rl

  const auth = await requireAuthenticated(request)
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

  // Authz: learner can only cancel slots they booked. Look up first.
  const slot = await getSlotById(id)
  if (!slot) {
    return NextResponse.json(
      { error: 'Slot not found.' },
      { status: 404, headers: noStore },
    )
  }
  if (slot.learnerAccountId !== auth.account.id) {
    return NextResponse.json(
      { error: 'Можно отменить только своё бронирование.' },
      { status: 403, headers: noStore },
    )
  }

  try {
    const cancelled = await cancelSlot(id, auth.account.id, reason, 'learner')
    if (!cancelled) {
      return NextResponse.json(
        { error: 'Слот уже отменён.' },
        { status: 409, headers: noStore },
      )
    }
    return NextResponse.json({ slot: cancelled }, { status: 200, headers: noStore })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    return NextResponse.json({ error: msg }, { status: 400, headers: noStore })
  }
}
