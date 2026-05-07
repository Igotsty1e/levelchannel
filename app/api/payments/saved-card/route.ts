import { NextResponse } from 'next/server'

import { getCurrentSession } from '@/lib/auth/sessions'
import { validateCustomerEmail } from '@/lib/payments/catalog'
import { paymentConfig } from '@/lib/payments/config'
import { deleteCardToken, getCardTokenByEmail } from '@/lib/payments/store'
import { toPublicSavedCard } from '@/lib/payments/tokens'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
} from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Codex 2026-05-07 (P0) — these endpoints used to authenticate ONLY by
// the request body's `customerEmail`. An anonymous attacker who knew a
// victim's email could:
//
//   (a) probe whether the victim has a saved card,
//   (b) DELETE the victim's saved card (loud UX break),
//   (c) trigger `chargeWithSavedCard` on the victim's card via the
//       sibling /api/payments/charge-token route (3-D Secure mitigates
//       most banks but ANY one-click-without-3DS card was fully exposed).
//
// Fix: required session, email comes from `session.account.email`, the
// request body's `customerEmail` is no longer trusted. Guest one-click
// based on knowing-the-email is removed; a guest who registered, saved
// a card, then logged out can still use it after login. The legitimate
// UX cost is small; the security gain is total.
//
// Anti-confused-deputy: we deliberately do NOT cross-check
// `body.customerEmail` against `session.account.email`. The session is
// the only trust anchor; what the body says is irrelevant. This avoids
// a class of bug where a stale form value silently routes a logged-in
// user's request to someone else's email.
const noStore = { 'Cache-Control': 'no-store, max-age=0' }

export async function POST(request: Request) {
  const rateLimitResponse = await enforceRateLimit(
    request,
    'payments:saved-card',
    10,
    60_000,
  )
  if (rateLimitResponse) {
    return rateLimitResponse
  }

  const originResponse = enforceTrustedBrowserOrigin(request)
  if (originResponse) {
    return originResponse
  }

  if (paymentConfig.provider !== 'cloudpayments') {
    return NextResponse.json({ savedCard: null }, { headers: noStore })
  }

  const session = await getCurrentSession(request)
  if (!session) {
    return NextResponse.json(
      { error: 'Войдите в аккаунт, чтобы использовать сохранённую карту.' },
      { status: 401, headers: noStore },
    )
  }

  const emailValidation = validateCustomerEmail(session.account.email)
  if (!emailValidation.ok) {
    return NextResponse.json({ savedCard: null }, { headers: noStore })
  }

  const saved = await getCardTokenByEmail(emailValidation.email)

  return NextResponse.json(
    { savedCard: saved ? toPublicSavedCard(saved) : null },
    { headers: noStore },
  )
}

export async function DELETE(request: Request) {
  const rateLimitResponse = await enforceRateLimit(
    request,
    'payments:saved-card-forget',
    10,
    60_000,
  )
  if (rateLimitResponse) {
    return rateLimitResponse
  }

  const originResponse = enforceTrustedBrowserOrigin(request)
  if (originResponse) {
    return originResponse
  }

  const session = await getCurrentSession(request)
  if (!session) {
    return NextResponse.json(
      { error: 'Войдите в аккаунт, чтобы удалить сохранённую карту.' },
      { status: 401, headers: noStore },
    )
  }

  const emailValidation = validateCustomerEmail(session.account.email)
  if (!emailValidation.ok) {
    return NextResponse.json(
      { error: emailValidation.message },
      { status: 400, headers: noStore },
    )
  }

  await deleteCardToken(emailValidation.email)

  return NextResponse.json({ ok: true }, { headers: noStore })
}
