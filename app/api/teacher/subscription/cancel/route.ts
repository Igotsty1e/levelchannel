// A2 — Mid/Pro teacher-subscription cancel route.
//
// Plan: docs/plans/saas-offer-and-landing-redesign.md A2.
//
// POST /api/teacher/subscription/cancel
//   Body: empty.
//   Auth: requireTeacherWithCurrentSaasOfferConsent.
//
// Semantics: marks cancelled_at on the teacher's subscription row.
// State stays `active` and the teacher keeps cabinet access until
// period_end (per v2 SaaS-оферта §4.2 — paid period is non-refundable
// pro-rata; teacher uses it through to expiry).
//
// Returns 404 if the teacher has no paid Mid/Pro subscription.
import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { requireTeacherWithCurrentSaasOfferConsent } from '@/lib/auth/guards'
import { cancelTeacherSubscription } from '@/lib/billing/teacher-subscription'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
} from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate

  const rl = await enforceRateLimit(
    request,
    'teacher:subscription:cancel:ip',
    10,
    60_000,
  )
  if (rl) return rl

  const guard = await requireTeacherWithCurrentSaasOfferConsent(request)
  if (!guard.ok) return guard.response

  const row = await cancelTeacherSubscription(guard.account.id)
  if (!row) {
    return NextResponse.json(
      {
        error: 'no_paid_subscription',
        message: 'У вас нет активной платной подписки.',
      },
      { status: 404, headers: NO_STORE },
    )
  }

  return NextResponse.json(
    {
      ok: true,
      planSlug: row.planSlug,
      cancelledAt: row.cancelledAt,
      periodEnd: row.periodEnd,
    },
    { status: 200, headers: NO_STORE },
  )
}
