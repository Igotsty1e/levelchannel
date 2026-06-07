import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { readJsonObjectOr400 } from '@/lib/api/json-body'
import { requireTeacherWithCurrentSaasOfferConsent } from '@/lib/auth/guards'
import {
  createPaymentMethod,
  listActivePaymentMethods,
} from '@/lib/payments/sbp-methods'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
} from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// teacher-payments-sbp-self-service Sub-PR A1.
//
// CRUD payment methods. Anti-spoof: teacher_account_id ВСЕГДА из
// `guard.account.id`, body's teacher field игнорируется.
// Plan: docs/plans/teacher-payments-sbp-self-service.md §3.1.

export async function GET(request: Request) {
  const rl = await enforceRateLimit(request, 'teacher:pay-methods:ip', 60, 60_000)
  if (rl) return rl

  const guard = await requireTeacherWithCurrentSaasOfferConsent(request)
  if (!guard.ok) return guard.response

  const methods = await listActivePaymentMethods(guard.account.id)
  return NextResponse.json({ methods }, { status: 200, headers: NO_STORE })
}

export async function POST(request: Request) {
  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate

  const rl = await enforceRateLimit(request, 'teacher:pay-methods:ip', 20, 60_000)
  if (rl) return rl

  const guard = await requireTeacherWithCurrentSaasOfferConsent(request)
  if (!guard.ok) return guard.response

  const parsed = await readJsonObjectOr400(request)
  if (!parsed.ok) return parsed.response
  const raw = parsed.body

  const phone = typeof raw.phone === 'string' ? raw.phone : null
  const bankLabel = typeof raw.bankLabel === 'string' ? raw.bankLabel : null
  const isDefault =
    typeof raw.isDefault === 'boolean' ? raw.isDefault : undefined

  if (!phone) {
    return NextResponse.json(
      { error: 'phone_required' },
      { status: 400, headers: NO_STORE },
    )
  }
  if (!bankLabel) {
    return NextResponse.json(
      { error: 'bank_required' },
      { status: 400, headers: NO_STORE },
    )
  }

  const result = await createPaymentMethod({
    teacherAccountId: guard.account.id,
    phoneRaw: phone,
    bankLabel,
    isDefault,
  })

  if (!result.ok) {
    const statusByReason: Record<string, number> = {
      invalid_phone: 400,
      invalid_bank: 400,
      limit_reached: 409,
    }
    return NextResponse.json(
      { error: result.reason },
      { status: statusByReason[result.reason] ?? 400, headers: NO_STORE },
    )
  }

  return NextResponse.json(
    { method: result.method, reused: result.reused },
    { status: result.reused ? 200 : 201, headers: NO_STORE },
  )
}
