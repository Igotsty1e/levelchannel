import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { readJsonObjectOr400 } from '@/lib/api/json-body'
import { requireTeacherWithCurrentSaasOfferConsent } from '@/lib/auth/guards'
import { createTeacherMarkPaid } from '@/lib/payments/sbp-claims'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
} from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate
  const rl = await enforceRateLimit(request, 'teacher:mark-paid:ip', 30, 60_000)
  if (rl) return rl

  const guard = await requireTeacherWithCurrentSaasOfferConsent(request)
  if (!guard.ok) return guard.response

  const parsed = await readJsonObjectOr400(request)
  if (!parsed.ok) return parsed.response
  const raw = parsed.body

  const learnerAccountId =
    typeof raw.learnerAccountId === 'string' ? raw.learnerAccountId : null
  const amountKopecks =
    typeof raw.amountKopecks === 'number' ? raw.amountKopecks : NaN
  const paymentChannel = raw.paymentChannel === 'other' ? 'other' : 'sbp'
  const paymentMethodId =
    typeof raw.paymentMethodId === 'string' ? raw.paymentMethodId : null
  const paidAt = typeof raw.paidAt === 'string' ? raw.paidAt : null
  const note = typeof raw.note === 'string' ? raw.note : undefined
  const itemsRaw = Array.isArray(raw.items) ? raw.items : []

  if (!learnerAccountId) {
    return NextResponse.json(
      { error: 'learner_required' },
      { status: 400, headers: NO_STORE },
    )
  }

  type ItemInput = {
    slotId: string | undefined
    packagePurchaseId: string | undefined
    expectedAmountKopecks: number
  }
  const items: ItemInput[] = itemsRaw
    .map((it: unknown): ItemInput | null => {
      if (typeof it !== 'object' || it === null) return null
      const r = it as Record<string, unknown>
      const slotId = typeof r.slotId === 'string' ? r.slotId : undefined
      const packagePurchaseId =
        typeof r.packagePurchaseId === 'string' ? r.packagePurchaseId : undefined
      const expectedAmountKopecks =
        typeof r.expectedAmountKopecks === 'number'
          ? r.expectedAmountKopecks
          : NaN
      if (!Number.isFinite(expectedAmountKopecks)) return null
      if (!slotId && !packagePurchaseId) return null
      return { slotId, packagePurchaseId, expectedAmountKopecks }
    })
    .filter((x): x is ItemInput => x !== null)

  const result = await createTeacherMarkPaid({
    teacherAccountId: guard.account.id,
    learnerAccountId,
    amountKopecks,
    paymentChannel,
    paymentMethodId,
    paidAt,
    items,
    note,
  })

  if (!result.ok) {
    const statusByReason: Record<string, number> = {
      slot_not_belongs_to_pair: 403,
      method_not_found: 403,
      package_not_found: 404,
      package_not_belongs_to_pair: 403,
      slot_not_found: 404,
      slot_has_active_claim: 409,
      slot_already_paid: 409,
      invalid_amount: 400,
      amount_too_large: 400,
      no_items: 400,
      too_many_items: 400,
      item_xor_violation: 400,
      invalid_paid_at: 400,
      paid_at_in_future: 400,
    }
    return NextResponse.json(
      { error: result.reason },
      { status: statusByReason[result.reason] ?? 400, headers: NO_STORE },
    )
  }
  return NextResponse.json(
    { claimId: result.claimId },
    { status: 201, headers: NO_STORE },
  )
}
