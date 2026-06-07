import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { readJsonObjectOr400 } from '@/lib/api/json-body'
import { lookupSession, SESSION_COOKIE_NAME } from '@/lib/auth/sessions'
import { createLearnerClaim } from '@/lib/payments/sbp-claims'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
} from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// teacher-payments-sbp-self-service Sub-PR C.
// Plan: docs/plans/teacher-payments-sbp-self-service.md §3.4

export async function POST(request: Request) {
  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate

  const rl = await enforceRateLimit(request, 'learner:claims:ip', 10, 60 * 60_000)
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
  if (!session.account.emailVerifiedAt) {
    return NextResponse.json({ error: 'email_not_verified' }, { status: 403, headers: NO_STORE })
  }

  const parsed = await readJsonObjectOr400(request)
  if (!parsed.ok) return parsed.response
  const raw = parsed.body

  const teacherAccountId = typeof raw.teacherAccountId === 'string' ? raw.teacherAccountId : null
  const amountKopecks = typeof raw.amountKopecks === 'number' ? raw.amountKopecks : NaN
  const paymentChannel = raw.paymentChannel === 'other' ? 'other' : 'sbp'
  const paymentMethodId =
    typeof raw.paymentMethodId === 'string' ? raw.paymentMethodId : null
  const note = typeof raw.note === 'string' ? raw.note : undefined
  const itemsRaw = Array.isArray(raw.items) ? raw.items : []

  if (!teacherAccountId) {
    return NextResponse.json({ error: 'teacher_required' }, { status: 400, headers: NO_STORE })
  }

  const items = itemsRaw
    .map((it: unknown) => {
      if (typeof it !== 'object' || it === null) return null
      const r = it as Record<string, unknown>
      const slotId = typeof r.slotId === 'string' ? r.slotId : undefined
      const packagePurchaseId =
        typeof r.packagePurchaseId === 'string' ? r.packagePurchaseId : undefined
      const expectedAmountKopecks =
        typeof r.expectedAmountKopecks === 'number' ? r.expectedAmountKopecks : NaN
      if (!Number.isFinite(expectedAmountKopecks)) return null
      if (!slotId && !packagePurchaseId) return null
      return { slotId, packagePurchaseId, expectedAmountKopecks }
    })
    .filter((x): x is { slotId?: string; packagePurchaseId?: string; expectedAmountKopecks: number } => x !== null)

  const result = await createLearnerClaim({
    learnerAccountId: session.account.id,
    teacherAccountId,
    amountKopecks,
    paymentChannel,
    paymentMethodId,
    items,
    note,
  })

  if (!result.ok) {
    const statusByReason: Record<string, number> = {
      slot_not_belongs_to_pair: 403,
      method_not_found: 403,
      package_not_found: 404,
      slot_not_found: 404,
      slot_has_active_claim: 409,
      method_archived: 409,
      invalid_amount: 400,
      amount_too_large: 400,
      no_items: 400,
      too_many_items: 400,
      method_required_for_sbp: 400,
      item_xor_violation: 400,
    }
    return NextResponse.json(
      { error: result.reason },
      { status: statusByReason[result.reason] ?? 400, headers: NO_STORE },
    )
  }
  return NextResponse.json({ claimId: result.claimId }, { status: 201, headers: NO_STORE })
}

function readCookie(header: string, name: string): string | null {
  const parts = header.split(';')
  for (const p of parts) {
    const [k, v] = p.trim().split('=')
    if (k === name) return v ?? null
  }
  return null
}
