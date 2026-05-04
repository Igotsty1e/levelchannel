import { NextResponse } from 'next/server'

import { requireAuthenticatedAndVerified } from '@/lib/auth/guards'
import { bookSlot } from '@/lib/scheduling/slots'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
} from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const noStore = { 'Cache-Control': 'no-store, max-age=0' }

type RouteParams = { params: Promise<{ id: string }> }

// POST /api/slots/[id]/book — learner books an open slot.
// Phase 4 D2: requires authenticated + email verified.
//
// Empty body. The atomic UPDATE in the store re-asserts status='open'
// in WHERE so two concurrent POSTs can't both win — the loser gets
// 409 with a friendly hint.

export async function POST(request: Request, { params }: RouteParams) {
  const { id } = await params

  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate

  const rl = await enforceRateLimit(request, 'slots:book:ip', 30, 60_000)
  if (rl) return rl

  const auth = await requireAuthenticatedAndVerified(request)
  if (!auth.ok) return auth.response

  const result = await bookSlot(id, auth.account.id, 'learner')
  if (result.ok) {
    return NextResponse.json({ slot: result.slot }, { status: 200, headers: noStore })
  }
  if (result.reason === 'not_found') {
    return NextResponse.json(
      { error: 'Slot not found.' },
      { status: 404, headers: noStore },
    )
  }
  if (result.reason === 'in_past') {
    return NextResponse.json(
      { error: 'Этот слот уже прошёл.' },
      { status: 410, headers: noStore },
    )
  }
  // not_open — race with another booking or operator-side state change.
  return NextResponse.json(
    { error: 'Этот слот только что забронировал кто-то другой. Обновите список.' },
    { status: 409, headers: noStore },
  )
}
