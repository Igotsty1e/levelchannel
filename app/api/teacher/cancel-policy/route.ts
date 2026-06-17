// POST /api/teacher/cancel-policy
//
// 2026-06-17 — учитель сохраняет per-teacher cancel-window в минутах.
// Owner-feedback: «нужно дать указать от 0 до 48 часов (включая минуты)».

import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { requireTeacherWithCurrentSaasOfferConsent } from '@/lib/auth/guards'
import { setTeacherCancelWindowMinutes } from '@/lib/scheduling/policy'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
} from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate
  const rl = await enforceRateLimit(
    request,
    'teacher:cancel-policy:ip',
    10,
    60_000,
  )
  if (rl) return rl
  const guard = await requireTeacherWithCurrentSaasOfferConsent(request)
  if (!guard.ok) return guard.response

  let body: { minutes?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: 'invalid_json' },
      { status: 400, headers: NO_STORE },
    )
  }
  const m = Number(body?.minutes)
  if (!Number.isFinite(m) || m < 0 || m > 2880) {
    return NextResponse.json(
      { error: 'minutes/range', message: 'Значение должно быть от 0 до 2880 (48 часов).' },
      { status: 400, headers: NO_STORE },
    )
  }
  await setTeacherCancelWindowMinutes(guard.account.id, m)
  return NextResponse.json({ ok: true, minutes: Math.round(m) }, { headers: NO_STORE })
}
