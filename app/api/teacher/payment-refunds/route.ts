import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { readJsonObjectOr400 } from '@/lib/api/json-body'
import { requireTeacherWithCurrentSaasOfferConsent } from '@/lib/auth/guards'
import { createRefund, type RefundReason } from '@/lib/payments/sbp-refunds'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
} from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const VALID_REASONS: RefundReason[] = [
  'slot_cancelled',
  'overpaid',
  'goodwill',
  'duplicate',
  'other',
]

export async function POST(request: Request) {
  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate
  const rl = await enforceRateLimit(request, 'teacher:refunds:ip', 30, 60_000)
  if (rl) return rl

  const guard = await requireTeacherWithCurrentSaasOfferConsent(request)
  if (!guard.ok) return guard.response

  const parsed = await readJsonObjectOr400(request)
  if (!parsed.ok) return parsed.response
  const raw = parsed.body

  const claimId = typeof raw.claimId === 'string' ? raw.claimId : null
  const amountKopecks =
    typeof raw.amountKopecks === 'number' ? raw.amountKopecks : NaN
  const reason =
    typeof raw.reason === 'string'
      && (VALID_REASONS as string[]).includes(raw.reason)
      ? (raw.reason as RefundReason)
      : null
  const note = typeof raw.note === 'string' ? raw.note : null

  if (!claimId) {
    return NextResponse.json(
      { error: 'claim_required' },
      { status: 400, headers: NO_STORE },
    )
  }
  if (!reason) {
    return NextResponse.json(
      { error: 'invalid_reason' },
      { status: 400, headers: NO_STORE },
    )
  }

  const result = await createRefund(
    guard.account.id,
    claimId,
    amountKopecks,
    reason,
    note,
  )
  if (!result.ok) {
    const statusByReason: Record<string, number> = {
      claim_not_found: 404,
      not_owner: 403,
      claim_not_confirmed: 409,
      refund_exceeds_claim: 409,
      invalid_amount: 400,
      amount_too_large: 400,
    }
    return NextResponse.json(
      { error: result.reason },
      { status: statusByReason[result.reason] ?? 400, headers: NO_STORE },
    )
  }
  return NextResponse.json(
    { refundId: result.refundId },
    { status: 201, headers: NO_STORE },
  )
}
