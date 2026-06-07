import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { readJsonObjectOr400 } from '@/lib/api/json-body'
import { requireTeacherWithCurrentSaasOfferConsent } from '@/lib/auth/guards'
import { setTeacherPaymentPolicy } from '@/lib/payments/sbp-claims'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
} from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function PATCH(request: Request) {
  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate
  const rl = await enforceRateLimit(request, 'teacher:policy:ip', 20, 60_000)
  if (rl) return rl

  const guard = await requireTeacherWithCurrentSaasOfferConsent(request)
  if (!guard.ok) return guard.response

  const parsed = await readJsonObjectOr400(request)
  if (!parsed.ok) return parsed.response
  const raw = parsed.body

  await setTeacherPaymentPolicy(guard.account.id, {
    chargeOnNoShow:
      typeof raw.chargeOnNoShow === 'boolean' ? raw.chargeOnNoShow : undefined,
    chargeOnLateCancel:
      typeof raw.chargeOnLateCancel === 'boolean'
        ? raw.chargeOnLateCancel
        : undefined,
  })
  return NextResponse.json({ ok: true }, { status: 200, headers: NO_STORE })
}
