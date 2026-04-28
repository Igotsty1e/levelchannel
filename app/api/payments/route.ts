import { NextResponse } from 'next/server'

import {
  normalizeCustomerEmail,
  isValidPaymentAmount,
  normalizePaymentAmount,
  validateCustomerEmail,
} from '@/lib/payments/catalog'
import { createPayment } from '@/lib/payments/provider'
import { appendCheckoutTelemetryEvent } from '@/lib/telemetry/store'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
  getClientIp,
} from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const rateLimitResponse = enforceRateLimit(request, 'payments:create', 10, 60_000)
  if (rateLimitResponse) {
    return rateLimitResponse
  }

  const originResponse = enforceTrustedBrowserOrigin(request)
  if (originResponse) {
    return originResponse
  }

  try {
    const body = (await request.json()) as {
      amountRub?: number | string
      customerEmail?: string
    }

    const amountRub = normalizePaymentAmount(Number(body.amountRub))
    const customerEmail = normalizeCustomerEmail(String(body.customerEmail || ''))
    const emailValidation = validateCustomerEmail(customerEmail)

    if (!isValidPaymentAmount(amountRub)) {
      await appendCheckoutTelemetryEvent({
        type: 'checkout_submit_rejected',
        amountRub,
        email: customerEmail,
        emailValid: emailValidation.ok,
        reason: 'invalid_amount',
        path: '/api/payments',
        userAgent: request.headers.get('user-agent') || undefined,
        ip: getClientIp(request),
      })

      return NextResponse.json(
        { error: 'Введите сумму от 10 до 10000 ₽.' },
        { status: 400 },
      )
    }

    if (!emailValidation.ok) {
      await appendCheckoutTelemetryEvent({
        type: 'checkout_submit_rejected',
        amountRub,
        email: customerEmail,
        emailValid: false,
        reason: emailValidation.reason,
        message: emailValidation.message,
        path: '/api/payments',
        userAgent: request.headers.get('user-agent') || undefined,
        ip: getClientIp(request),
      })

      return NextResponse.json(
        { error: emailValidation.message },
        { status: 400 },
      )
    }

    const { order, checkoutIntent } = await createPayment(amountRub, emailValidation.email)

    return NextResponse.json(
      { order, checkoutIntent },
      {
        headers: {
          'Cache-Control': 'no-store, max-age=0',
        },
      },
    )
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unable to create payment.'
    const status =
      message === 'CloudPayments credentials are not configured.'
        ? 503
        : 500

    return NextResponse.json({ error: message }, { status })
  }
}
