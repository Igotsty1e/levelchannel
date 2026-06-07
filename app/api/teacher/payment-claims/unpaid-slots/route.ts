import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { requireTeacherWithCurrentSaasOfferConsent } from '@/lib/auth/guards'
import { listUnpaidSlotsForPair } from '@/lib/payments/sbp-claims'
import { enforceRateLimit } from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const rl = await enforceRateLimit(request, 'teacher:unpaid-slots:ip', 60, 60_000)
  if (rl) return rl

  const guard = await requireTeacherWithCurrentSaasOfferConsent(request)
  if (!guard.ok) return guard.response

  const url = new URL(request.url)
  const learnerId = url.searchParams.get('learner')
  if (!learnerId) {
    return NextResponse.json(
      { error: 'learner_required' },
      { status: 400, headers: NO_STORE },
    )
  }
  const slots = await listUnpaidSlotsForPair(guard.account.id, learnerId)
  return NextResponse.json({ slots }, { status: 200, headers: NO_STORE })
}
