import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { requireLearnerArchetypeAndVerified } from '@/lib/auth/guards'
import { bookSlot } from '@/lib/scheduling/slots'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
} from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'


type RouteParams = { params: Promise<{ id: string }> }

// POST /api/slots/[id]/book — learner books an open slot.
// Phase 4 D2: requires authenticated + email verified.
//
// Body is optional. BCS-B.1 adds `{ agenda?: string }` for Calendly-
// confirm comment capture; legacy clients sending empty bodies stay
// supported (agenda → null). Invalid JSON in the body is tolerated —
// we degrade to "no agenda" rather than reject the booking; the
// learner's intent (book this slot) outranks the optional comment.
//
// The atomic UPDATE in the store re-asserts status='open' in WHERE so
// two concurrent POSTs can't both win — the loser gets 409 with a
// friendly hint.

export async function POST(request: Request, { params }: RouteParams) {
  const { id } = await params

  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate

  const rl = await enforceRateLimit(request, 'slots:book:ip', 30, 60_000)
  if (rl) return rl

  const auth = await requireLearnerArchetypeAndVerified(request)
  if (!auth.ok) return auth.response

  // BCS-B.1 soft body parse — tolerant of empty body or malformed JSON.
  // sanitizeAgenda inside bookSlot defends against over-cap input.
  let agenda: string | null = null
  try {
    const raw = await request.text()
    if (raw && raw.trim().length > 0) {
      const parsed = JSON.parse(raw) as unknown
      if (
        typeof parsed === 'object'
        && parsed !== null
        && !Array.isArray(parsed)
        && typeof (parsed as { agenda?: unknown }).agenda === 'string'
      ) {
        agenda = (parsed as { agenda: string }).agenda
      }
    }
  } catch {
    // Invalid JSON → agenda stays null; do not block the booking.
  }

  // BCS-B.frontend Codex #1: pin booking to learner's assigned teacher
  // so a verified learner who knows a foreign teacher's open slot id
  // cannot book it. The atomic UPDATE inside bookSlot re-asserts
  // teacher_account_id = $expectedTeacherId; a mismatch collapses to
  // the same not_found outcome (no enumeration of foreign slots).
  //
  // When assignedTeacherId is null (a learner not yet bound to any
  // teacher), we deliberately do NOT enforce the gate — the legacy
  // behaviour passes through. Production learners are always assigned
  // before they can register-and-checkout, so the typical case
  // exercises the gate. The legacy null path stays open for two
  // reasons: (a) backward compat with the historical test suite that
  // books slots without prior teacher binding, and (b) admin-side
  // operator flow that may pre-create a learner+slot pair before the
  // teacher binding lands. Tracked as a follow-up hardening item in
  // ENGINEERING_BACKLOG.md (Wave BCS-B).
  const expectedTeacherId = auth.account.assignedTeacherId ?? null

  const result = await bookSlot(id, auth.account.id, 'learner', {
    agenda,
    expectedTeacherId,
  })
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
