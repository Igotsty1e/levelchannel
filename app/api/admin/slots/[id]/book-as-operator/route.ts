import { NextResponse } from 'next/server'

import { readJsonObjectOr400 } from '@/lib/api/json-body'
import { getAccountByEmail } from '@/lib/auth/accounts'
import { requireAdminRole } from '@/lib/auth/guards'
import { bookSlot } from '@/lib/scheduling/slots'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
} from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' }

type RouteParams = { params: Promise<{ id: string }> }

// POST /api/admin/slots/[id]/book-as-operator
// Body: { learnerEmail: string }
//
// Operator books the slot on behalf of the named learner. The learner
// must exist and have a verified e-mail (we hold the same email-
// verification gate operator-side as we do for self-booking, otherwise
// admins could attach a slot to a half-registered account).

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
  if (typeof parsed.body.learnerEmail !== 'string') {
    return NextResponse.json(
      {
        error: 'invalid_learner_email',
        message: 'Body must include { learnerEmail: string }.',
      },
      { status: 400, headers: NO_STORE },
    )
  }
  const learnerEmail = parsed.body.learnerEmail

  const learner = await getAccountByEmail(learnerEmail)
  if (!learner) {
    return NextResponse.json(
      {
        error: 'learner_not_found',
        message: 'Учащийся с таким e-mail не найден.',
      },
      { status: 404, headers: NO_STORE },
    )
  }
  if (!learner.emailVerifiedAt) {
    return NextResponse.json(
      {
        error: 'learner_email_unverified',
        message:
          'У этого учащегося не подтверждён e-mail. Попросите его подтвердить адрес перед бронированием.',
      },
      { status: 400, headers: NO_STORE },
    )
  }
  if (learner.disabledAt) {
    return NextResponse.json(
      {
        error: 'learner_disabled',
        message: 'Аккаунт учащегося отключён.',
      },
      { status: 400, headers: NO_STORE },
    )
  }

  const result = await bookSlot(id, learner.id, 'admin')
  if (result.ok) {
    return NextResponse.json({ slot: result.slot }, { status: 200, headers: NO_STORE })
  }
  if (result.reason === 'not_found') {
    return NextResponse.json(
      { error: 'not_found', message: 'Слот не найден.' },
      { status: 404, headers: NO_STORE },
    )
  }
  if (result.reason === 'in_past') {
    return NextResponse.json(
      { error: 'in_past', message: 'Слот уже прошёл.' },
      { status: 410, headers: NO_STORE },
    )
  }
  if (result.reason === 'self_booking_blocked') {
    return NextResponse.json(
      {
        error: 'self_booking_blocked',
        message:
          'Учитель не может быть учеником в собственном слоте. Выберите другой аккаунт.',
      },
      { status: 400, headers: NO_STORE },
    )
  }
  return NextResponse.json(
    { error: 'not_open', message: 'Слот уже не open.' },
    { status: 409, headers: NO_STORE },
  )
}
