import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { requireTeacherWithCurrentSaasOfferConsent } from '@/lib/auth/guards'
import { confirmClaim } from '@/lib/payments/sbp-claims'
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
  const rl = await enforceRateLimit(request, 'teacher:claims:ip', 60, 60_000)
  if (rl) return rl

  const guard = await requireTeacherWithCurrentSaasOfferConsent(request)
  if (!guard.ok) return guard.response

  const { id } = await context.params
  const r = await confirmClaim(guard.account.id, id)
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
