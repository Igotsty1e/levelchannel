import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { lookupSession, SESSION_COOKIE_NAME } from '@/lib/auth/sessions'
import { getPayContextForSlot } from '@/lib/payments/sbp-claims'
import { enforceRateLimit } from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Returns SBP details + slot summary for the «Оплатить» modal.

export async function GET(
  request: Request,
  context: { params: Promise<{ slotId: string }> },
) {
  const rl = await enforceRateLimit(request, 'learner:pay-ctx:ip', 60, 60_000)
  if (rl) return rl

  const cookieHeader = request.headers.get('cookie') ?? ''
  const cookieValue = readCookie(cookieHeader, SESSION_COOKIE_NAME)
  if (!cookieValue) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401, headers: NO_STORE })
  }
  const session = await lookupSession(cookieValue)
  if (!session) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401, headers: NO_STORE })
  }
  const { slotId } = await context.params
  const r = await getPayContextForSlot(session.account.id, slotId)
  if (!r.ok) {
    const status = r.reason === 'not_your_slot' ? 403 : 404
    return NextResponse.json({ error: r.reason }, { status, headers: NO_STORE })
  }
  return NextResponse.json(
    {
      teacherAccountId: r.teacherAccountId,
      teacherName: r.teacherName,
      slotLabel: r.slotLabel,
      expectedAmountKopecks: r.expectedAmountKopecks,
      paymentMethod: r.paymentMethod,
    },
    { status: 200, headers: NO_STORE },
  )
}

function readCookie(header: string, name: string): string | null {
  const parts = header.split(';')
  for (const p of parts) {
    const [k, v] = p.trim().split('=')
    if (k === name) return v ?? null
  }
  return null
}
