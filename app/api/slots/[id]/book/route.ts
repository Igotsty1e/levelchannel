import { NextResponse } from 'next/server'

import { requireLearnerArchetypeAndVerified } from '@/lib/auth/guards'
import { bookSlot } from '@/lib/scheduling/slots'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
} from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' }

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

  const auth = await requireLearnerArchetypeAndVerified(request)
  if (!auth.ok) return auth.response

  const result = await bookSlot(id, auth.account.id, 'learner')
  if (result.ok) {
    return NextResponse.json(
      { slot: result.slot, billing: result.billing },
      { status: 200, headers: NO_STORE },
    )
  }
  if (result.reason === 'not_found') {
    return NextResponse.json(
      { error: 'Slot not found.' },
      { status: 404, headers: NO_STORE },
    )
  }
  if (result.reason === 'in_past') {
    return NextResponse.json(
      { error: 'Этот слот уже прошёл.' },
      { status: 410, headers: NO_STORE },
    )
  }
  if (result.reason === 'self_booking_blocked') {
    return NextResponse.json(
      { error: 'Нельзя забронировать слот, где вы числитесь преподавателем.' },
      { status: 403, headers: NO_STORE },
    )
  }
  // Billing wave PR 1 — new failure shapes.
  if (result.reason === 'package_required') {
    return NextResponse.json(
      {
        error: 'package_required',
        message: 'Чтобы записаться, купите пакет уроков.',
        availablePackages: result.availablePackages ?? [],
      },
      { status: 402, headers: NO_STORE },
    )
  }
  if (result.reason === 'tariff_required') {
    return NextResponse.json(
      {
        error: 'tariff_required',
        message:
          'У этого слота не указана цена. Свяжитесь с оператором.',
      },
      { status: 402, headers: NO_STORE },
    )
  }
  if (result.reason === 'pending_package_grant') {
    return NextResponse.json(
      {
        error: 'pending_package_grant',
        message:
          'У вас оформляется пакет — подождите минуту и обновите.',
      },
      { status: 409, headers: NO_STORE },
    )
  }
  // not_open — race with another booking or operator-side state change.
  return NextResponse.json(
    { error: 'Этот слот только что забронировал кто-то другой. Обновите список.' },
    { status: 409, headers: NO_STORE },
  )
}
