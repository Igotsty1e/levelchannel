import { NextResponse } from 'next/server'

import { recordPaymentAuditEvent, rublesToKopecks } from '@/lib/audit/payment-events'
import { buildPersonalDataConsentSnapshot } from '@/lib/legal/personal-data'
import {
  formatRubles,
  MAX_PAYMENT_AMOUNT_RUB,
  MIN_PAYMENT_AMOUNT_RUB,
  normalizeCustomerEmail,
  isValidPaymentAmount,
  normalizePaymentAmount,
  validateCustomerEmail,
} from '@/lib/payments/catalog'
import { createPayment } from '@/lib/payments/provider'
import { appendCheckoutTelemetryEvent } from '@/lib/telemetry/store'
import { withIdempotency } from '@/lib/security/idempotency'
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

  // Читаем body один раз — он нужен и для idempotency hash, и для бизнес-логики.
  const rawBody = await request.text()

  return withIdempotency(request, 'payments:create', rawBody, async () => {
    let body: {
      amountRub?: number | string
      customerEmail?: string
      rememberCard?: boolean
      personalDataConsentAccepted?: boolean
    }

    try {
      body = rawBody ? JSON.parse(rawBody) : {}
    } catch {
      return { status: 400, body: { error: 'Invalid request body.' } }
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

      return {
        status: 400,
        body: {
          error: `Введите сумму от ${formatRubles(MIN_PAYMENT_AMOUNT_RUB)} до ${formatRubles(MAX_PAYMENT_AMOUNT_RUB)} ₽.`,
        },
      }
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

      return {
        status: 400,
        body: { error: emailValidation.message },
      }
    }

    if (body.personalDataConsentAccepted !== true) {
      return {
        status: 400,
        body: { error: 'Подтвердите согласие на обработку персональных данных.' },
      }
    }

    try {
      const { order, checkoutIntent } = await createPayment(
        amountRub,
        emailValidation.email,
        {
          rememberCard: body.rememberCard === true,
          personalDataConsent: buildPersonalDataConsentSnapshot({
            ipAddress: getClientIp(request),
            userAgent: request.headers.get('user-agent') || undefined,
          }),
        },
      )

      await recordPaymentAuditEvent({
        eventType: 'order.created',
        invoiceId: order.invoiceId,
        customerEmail: emailValidation.email,
        clientIp: getClientIp(request),
        userAgent: request.headers.get('user-agent') || null,
        amountKopecks: rublesToKopecks(order.amountRub),
        toStatus: order.status,
        actor: 'user',
        idempotencyKey: request.headers.get('idempotency-key') || null,
        payload: {
          provider: order.provider,
          rememberCard: body.rememberCard === true,
        },
      })

      return {
        status: 200,
        body: { order, checkoutIntent },
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to create payment.'
      const status =
        message === 'CloudPayments credentials are not configured.' ? 503 : 500

      return { status, body: { error: message } }
    }
  })
}

// Глобальный fallback на случай неожиданного выхода — не должен срабатывать,
// все ветки above уже возвращают NextResponse / outcome.
export async function GET() {
  return NextResponse.json({ error: 'Method Not Allowed' }, { status: 405 })
}
