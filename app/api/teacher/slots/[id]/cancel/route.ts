import { NextResponse } from 'next/server'

import { requireTeacherAndVerified } from '@/lib/auth/guards'
import { cancelSlotByTeacher } from '@/lib/scheduling/slots'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
} from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' }

type RouteParams = { params: Promise<{ id: string }> }

// Wave C — teacher-owned cancel. `reason` is REQUIRED for booked
// slots (a learner is being told their lesson is off — they deserve
// a reason in the audit trail). Optional for open slots (no learner
// involved).
//
// Body: { reason?: string }

export async function POST(request: Request, { params }: RouteParams) {
  const { id } = await params

  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate

  const rl = await enforceRateLimit(
    request,
    'teacher:slots:cancel:ip',
    30,
    60_000,
  )
  if (rl) return rl

  const guard = await requireTeacherAndVerified(request)
  if (!guard.ok) return guard.response

  // An empty body is acceptable (cancelling an open slot doesn't need
  // a reason). A MALFORMED body, however, indicates a broken caller
  // and must 400 — otherwise a corrupt body silently cancels the
  // slot without the operator's payload reaching the audit trail.
  // (Empty body → no Content-Length → request.text() returns ''; we
  // detect that and treat as "no reason supplied".)
  let body: unknown = {}
  const raw = await request.text().catch(() => '')
  if (raw.length > 0) {
    try {
      body = JSON.parse(raw)
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON body.' },
        { status: 400, headers: NO_STORE },
      )
    }
  }
  const reasonRaw =
    typeof body === 'object' &&
    body !== null &&
    typeof (body as Record<string, unknown>).reason === 'string'
      ? ((body as Record<string, unknown>).reason as string)
      : null
  const reason = reasonRaw !== null && reasonRaw.trim() !== '' ? reasonRaw.trim() : null

  try {
    const result = await cancelSlotByTeacher(id, guard.account.id, reason)
    if (result.ok) {
      return NextResponse.json(
        { slot: result.slot },
        { status: 200, headers: NO_STORE },
      )
    }
    if (result.reason === 'not_found') {
      return NextResponse.json(
        { error: 'not_found' },
        { status: 404, headers: NO_STORE },
      )
    }
    if (result.reason === 'not_owner') {
      return NextResponse.json(
        {
          error: 'not_owner',
          message: 'Этот слот не принадлежит вашему аккаунту.',
        },
        { status: 403, headers: NO_STORE },
      )
    }
    if (result.reason === 'reason_required_for_booked') {
      return NextResponse.json(
        {
          error: 'reason_required_for_booked',
          message:
            'Чтобы отменить забронированный слот, укажите причину для ученика.',
        },
        { status: 400, headers: NO_STORE },
      )
    }
    // already_terminal
    return NextResponse.json(
      {
        error: 'already_terminal',
        message: 'Слот уже отменён или завершён.',
      },
      { status: 409, headers: NO_STORE },
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    if (msg === 'slot/cancellationReason/too_long') {
      return NextResponse.json(
        {
          error: 'reason_too_long',
          message: 'Причина не должна быть длиннее 500 символов.',
        },
        { status: 400, headers: NO_STORE },
      )
    }
    console.error('[teacher.slots.cancel] unexpected error', err)
    return NextResponse.json(
      { error: 'internal_error' },
      { status: 500, headers: NO_STORE },
    )
  }
}
