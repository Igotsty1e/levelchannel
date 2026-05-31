import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { requireTeacherWithCurrentSaasOfferConsent } from '@/lib/auth/guards'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
} from '@/lib/security/request'
import {
  setSlotZoomUrl,
  validateZoomUrl,
} from '@/lib/scheduling/slots'

// BCS-DEF-3 (2026-05-18) — PATCH /api/teacher/slots/[id]/zoom-url.
// Teacher sets/clears zoom URL on their OWN booked slot. Body:
// `{ zoomUrl }` (string to set; null/empty to clear). Ownership
// gate lives in the SQL UPDATE WHERE clause; route returns 403
// with `not_owner` reason on mismatch.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteParams = { params: Promise<{ id: string }> }

export async function PATCH(request: Request, { params }: RouteParams) {
  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate

  const rl = await enforceRateLimit(
    request,
    'teacher:slots:zoom-url:ip',
    30,
    60_000,
  )
  if (rl) return rl

  const auth = await requireTeacherWithCurrentSaasOfferConsent(request)
  if (!auth.ok) return auth.response

  const { id } = await params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: 'invalid_body' },
      { status: 400, headers: NO_STORE },
    )
  }
  if (!body || typeof body !== 'object') {
    return NextResponse.json(
      { error: 'invalid_body' },
      { status: 400, headers: NO_STORE },
    )
  }
  const raw = (body as Record<string, unknown>).zoomUrl
  let zoomUrl: string | null
  if (raw === null || raw === '' || raw === undefined) {
    zoomUrl = null
  } else if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (trimmed.length === 0) {
      zoomUrl = null
    } else {
      const v = validateZoomUrl(trimmed)
      if (v) {
        return NextResponse.json(
          { error: 'invalid_url', reason: v.reason },
          { status: 400, headers: NO_STORE },
        )
      }
      zoomUrl = trimmed
    }
  } else {
    return NextResponse.json(
      { error: 'invalid_body' },
      { status: 400, headers: NO_STORE },
    )
  }

  const result = await setSlotZoomUrl(id, zoomUrl, auth.account.id, 'teacher')
  if (!result.ok) {
    const statusMap = {
      not_found: 404,
      not_booked: 409,
      not_owner: 403,
      invalid_url: 400,
    } as const
    return NextResponse.json(
      { error: result.reason },
      { status: statusMap[result.reason], headers: NO_STORE },
    )
  }
  return NextResponse.json(
    { ok: true, slot: result.slot },
    { headers: NO_STORE },
  )
}
