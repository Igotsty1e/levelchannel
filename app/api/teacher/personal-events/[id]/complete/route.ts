// Epic B (2026-06-19) — POST /api/teacher/personal-events/{id}/complete.

import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { requireTeacherWithCurrentSaasOfferConsent } from '@/lib/auth/guards'
import { completePersonalEvent } from '@/lib/scheduling/slots'
import { enforceAccountRateLimit } from '@/lib/security/account-rate-limit'
import { enforceTrustedBrowserOrigin } from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type RouteParams = { params: Promise<{ id: string }> }

export async function POST(request: Request, { params }: RouteParams) {
  const { id } = await params
  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate
  const guard = await requireTeacherWithCurrentSaasOfferConsent(request)
  if (!guard.ok) return guard.response
  const rl = await enforceAccountRateLimit(
    guard.account.id,
    'teacher:personal-event:complete',
    60,
    60 * 60 * 1000,
  )
  if (rl) return rl
  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404, headers: NO_STORE })
  }
  const result = await completePersonalEvent(id, guard.account.id)
  if (!result.ok) {
    if (result.reason === 'not_found' || result.reason === 'not_owner') {
      return NextResponse.json(
        { error: 'not_found' },
        { status: 404, headers: NO_STORE },
      )
    }
    return NextResponse.json(
      {
        error: result.reason,
        message: 'Дело уже завершено или не активно.',
      },
      { status: 409, headers: NO_STORE },
    )
  }
  return NextResponse.json({ ok: true, slot: result.slot }, { headers: NO_STORE })
}
