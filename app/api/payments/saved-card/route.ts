import { NextResponse } from 'next/server'

import {
  normalizeCustomerEmail,
  validateCustomerEmail,
} from '@/lib/payments/catalog'
import { paymentConfig } from '@/lib/payments/config'
import { deleteCardToken, getCardTokenByEmail } from '@/lib/payments/store'
import { toPublicSavedCard } from '@/lib/payments/tokens'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
} from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// POST вместо GET — чтобы e-mail не оседал в логах reverse-proxy / CDN.
// Этот эндпоинт раскрывает факт «у этого e-mail есть сохранённая карта»,
// поэтому стоит за жёстким per-IP rate-limit и origin-check.
export async function POST(request: Request) {
  const rateLimitResponse = enforceRateLimit(
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
    return NextResponse.json(
      { savedCard: null },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } },
    )
  }

  let body: { customerEmail?: string }

  try {
    body = (await request.json()) as { customerEmail?: string }
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const normalizedEmail = normalizeCustomerEmail(String(body.customerEmail || ''))
  const emailValidation = validateCustomerEmail(normalizedEmail)

  if (!emailValidation.ok) {
    return NextResponse.json(
      { savedCard: null },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } },
    )
  }

  const saved = await getCardTokenByEmail(emailValidation.email)

  return NextResponse.json(
    { savedCard: saved ? toPublicSavedCard(saved) : null },
    { headers: { 'Cache-Control': 'no-store, max-age=0' } },
  )
}

// DELETE с email в теле — не GET-параметром, чтобы e-mail не оседал в логах.
export async function DELETE(request: Request) {
  const rateLimitResponse = enforceRateLimit(
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

  let body: { customerEmail?: string }

  try {
    body = (await request.json()) as { customerEmail?: string }
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const normalizedEmail = normalizeCustomerEmail(String(body.customerEmail || ''))
  const emailValidation = validateCustomerEmail(normalizedEmail)

  if (!emailValidation.ok) {
    return NextResponse.json({ error: emailValidation.message }, { status: 400 })
  }

  await deleteCardToken(emailValidation.email)

  return NextResponse.json(
    { ok: true },
    { headers: { 'Cache-Control': 'no-store, max-age=0' } },
  )
}
