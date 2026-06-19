// Epic B (2026-06-19) — POST /api/teacher/personal-events/{id}/cancel.
//
// Body (optional): { reason?: string<=500 }

import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { readJsonObjectOr400 } from '@/lib/api/json-body'
import { requireTeacherWithCurrentSaasOfferConsent } from '@/lib/auth/guards'
import { cancelPersonalEventByTeacher } from '@/lib/scheduling/slots'
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
    'teacher:personal-event:cancel',
    60,
    60 * 60 * 1000,
  )
  if (rl) return rl
  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404, headers: NO_STORE })
  }
  let reason: string | null = null
  const contentLength = request.headers.get('content-length')
  if (contentLength && Number.parseInt(contentLength, 10) > 0) {
    const parsed = await readJsonObjectOr400(request, { coded: true })
    if (!parsed.ok) return parsed.response
    if (typeof parsed.body.reason === 'string') {
      const trimmed = parsed.body.reason.trim()
      if (trimmed.length > 500) {
        return NextResponse.json(
          { error: 'reason_too_long', message: 'Причина — до 500 символов.' },
          { status: 400, headers: NO_STORE },
        )
      }
      reason = trimmed.length > 0 ? trimmed : null
    }
  }
  const result = await cancelPersonalEventByTeacher(id, guard.account.id, reason)
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
