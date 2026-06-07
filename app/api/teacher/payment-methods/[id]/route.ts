import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { readJsonObjectOr400 } from '@/lib/api/json-body'
import { requireTeacherWithCurrentSaasOfferConsent } from '@/lib/auth/guards'
import {
  archivePaymentMethod,
  updatePaymentMethod,
} from '@/lib/payments/sbp-methods'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
} from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// teacher-payments-sbp-self-service Sub-PR A1.
// Plan: docs/plans/teacher-payments-sbp-self-service.md §3.1.

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate

  const rl = await enforceRateLimit(request, 'teacher:pay-methods:ip', 20, 60_000)
  if (rl) return rl

  const guard = await requireTeacherWithCurrentSaasOfferConsent(request)
  if (!guard.ok) return guard.response

  const { id } = await context.params

  const parsed = await readJsonObjectOr400(request)
  if (!parsed.ok) return parsed.response
  const raw = parsed.body

  const result = await updatePaymentMethod({
    teacherAccountId: guard.account.id,
    methodId: id,
    phoneRaw: typeof raw.phone === 'string' ? raw.phone : undefined,
    bankLabel: typeof raw.bankLabel === 'string' ? raw.bankLabel : undefined,
    isDefault: typeof raw.isDefault === 'boolean' ? raw.isDefault : undefined,
    restore: raw.restore === true,
  })

  if (!result.ok) {
    const status = result.reason === 'not_found' ? 404 : 400
    return NextResponse.json(
      { error: result.reason },
      { status, headers: NO_STORE },
    )
  }
  return NextResponse.json({ method: result.method }, { status: 200, headers: NO_STORE })
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate

  const rl = await enforceRateLimit(request, 'teacher:pay-methods:ip', 20, 60_000)
  if (rl) return rl

  const guard = await requireTeacherWithCurrentSaasOfferConsent(request)
  if (!guard.ok) return guard.response

  const { id } = await context.params
  const result = await archivePaymentMethod(guard.account.id, id)
  if (!result.ok) {
    return NextResponse.json(
      { error: result.reason },
      { status: 404, headers: NO_STORE },
    )
  }
  return NextResponse.json({ ok: true }, { status: 200, headers: NO_STORE })
}
