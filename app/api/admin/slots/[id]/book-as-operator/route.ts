import { NextResponse } from 'next/server'

import { getAccountByEmail } from '@/lib/auth/accounts'
import { requireAdminRole } from '@/lib/auth/guards'
import { bookSlot } from '@/lib/scheduling/slots'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
} from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const noStore = { 'Cache-Control': 'no-store, max-age=0' }

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

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body.' },
      { status: 400, headers: noStore },
    )
  }
  if (
    typeof body !== 'object' ||
    body === null ||
    typeof (body as Record<string, unknown>).learnerEmail !== 'string'
  ) {
    return NextResponse.json(
      { error: 'Body must include { learnerEmail: string }.' },
      { status: 400, headers: noStore },
    )
  }
  const learnerEmail = (body as { learnerEmail: string }).learnerEmail

  const learner = await getAccountByEmail(learnerEmail)
  if (!learner) {
    return NextResponse.json(
      { error: 'Учащийся с таким e-mail не найден.' },
      { status: 404, headers: noStore },
    )
  }
  if (!learner.emailVerifiedAt) {
    return NextResponse.json(
      {
        error:
          'У этого учащегося не подтверждён e-mail. Попросите его подтвердить адрес перед бронированием.',
      },
      { status: 400, headers: noStore },
    )
  }
  if (learner.disabledAt) {
    return NextResponse.json(
      { error: 'Аккаунт учащегося отключён.' },
      { status: 400, headers: noStore },
    )
  }

  const result = await bookSlot(id, learner.id, 'admin')
  if (result.ok) {
    return NextResponse.json({ slot: result.slot }, { status: 200, headers: noStore })
  }
  if (result.reason === 'not_found') {
    return NextResponse.json(
      { error: 'Слот не найден.' },
      { status: 404, headers: noStore },
    )
  }
  if (result.reason === 'in_past') {
    return NextResponse.json(
      { error: 'Слот уже прошёл.' },
      { status: 410, headers: noStore },
    )
  }
  return NextResponse.json(
    { error: 'Слот уже не open.' },
    { status: 409, headers: noStore },
  )
}
