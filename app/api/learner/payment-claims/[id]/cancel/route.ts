import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { readSessionCookie } from '@/lib/auth/cookies'
import { lookupSession, SESSION_COOKIE_NAME } from '@/lib/auth/sessions'
import { cancelClaimByLearner } from '@/lib/payments/sbp-claims'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
} from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate
  const rl = await enforceRateLimit(request, 'learner:claims:ip', 30, 60_000)
  if (rl) return rl

  const cookieValue = readSessionCookie(request, SESSION_COOKIE_NAME)
  if (!cookieValue) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401, headers: NO_STORE })
  }
  const session = await lookupSession(cookieValue)
  if (!session) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401, headers: NO_STORE })
  }
  const { id } = await context.params
  const r = await cancelClaimByLearner(session.account.id, id)
  if (!r.ok) {
    const status =
      r.reason === 'not_found' ? 404 : r.reason === 'already_resolved' ? 409 : 400
    return NextResponse.json(
      { error: r.reason, currentStatus: r.currentStatus },
      { status, headers: NO_STORE },
    )
  }
  return NextResponse.json({ ok: true }, { status: 200, headers: NO_STORE })
}

