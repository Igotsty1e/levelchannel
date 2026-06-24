// teacher-lessons-edit-status epic (2026-06-24) — change deal status.
// Plan: docs/plans/teacher-lessons-edit-status-2026-06-24.md §1.2.

import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { requireTeacherWithCurrentSaasOfferConsent } from '@/lib/auth/guards'
import { changeDealStatus, type DealTargetStatus } from '@/lib/scheduling/slots'
import { enforceAccountRateLimit } from '@/lib/security/account-rate-limit'
import { enforceTrustedBrowserOrigin } from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const ALLOWED_TARGETS: DealTargetStatus[] = ['personal_event', 'completed', 'cancelled']

type RouteParams = { params: Promise<{ id: string }> }

export async function POST(request: Request, { params }: RouteParams) {
  const { id } = await params
  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate

  const guard = await requireTeacherWithCurrentSaasOfferConsent(request)
  if (!guard.ok) return guard.response

  const rl = await enforceAccountRateLimit(
    guard.account.id,
    'teacher:deal:change-status',
    60,
    60 * 60 * 1000,
  )
  if (rl) return rl

  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404, headers: NO_STORE })
  }

  let body: { to?: unknown; expectedUpdatedAt?: unknown }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return NextResponse.json(
      { error: 'invalid_body', message: 'Некорректный запрос.' },
      { status: 400, headers: NO_STORE },
    )
  }

  if (typeof body.to !== 'string' || !ALLOWED_TARGETS.includes(body.to as DealTargetStatus)) {
    return NextResponse.json(
      { error: 'invalid_to', message: 'Недопустимый целевой статус.' },
      { status: 400, headers: NO_STORE },
    )
  }
  if (typeof body.expectedUpdatedAt !== 'string' || !body.expectedUpdatedAt) {
    return NextResponse.json(
      { error: 'invalid_expected_updated_at' },
      { status: 400, headers: NO_STORE },
    )
  }

  const result = await changeDealStatus({
    slotId: id,
    teacherAccountId: guard.account.id,
    toStatus: body.to as DealTargetStatus,
    expectedUpdatedAt: body.expectedUpdatedAt,
  })

  if (!result.ok) {
    return errorResponse(result.reason)
  }

  return NextResponse.json(
    { ok: true, slotId: id, newUpdatedAt: result.newUpdatedAt },
    { headers: NO_STORE },
  )
}

function errorResponse(reason: string) {
  switch (reason) {
    case 'not_found':
      return NextResponse.json({ error: 'not_found' }, { status: 404, headers: NO_STORE })
    case 'not_owner':
      return NextResponse.json(
        { error: 'not_owner', message: 'Это дело не принадлежит вашему аккаунту.' },
        { status: 403, headers: NO_STORE },
      )
    case 'wrong_kind':
      return NextResponse.json(
        { error: 'wrong_kind', message: 'Этот слот не является делом.' },
        { status: 400, headers: NO_STORE },
      )
    case 'stale':
      return NextResponse.json(
        { error: 'stale', message: 'Дело уже было изменено. Обновите страницу.' },
        { status: 409, headers: NO_STORE },
      )
    case 'invalid_transition':
      return NextResponse.json(
        { error: 'invalid_transition', message: 'Недопустимое изменение статуса.' },
        { status: 422, headers: NO_STORE },
      )
    default:
      return NextResponse.json({ error: 'internal_error' }, { status: 500, headers: NO_STORE })
  }
}
