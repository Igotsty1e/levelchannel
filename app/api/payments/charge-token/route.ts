import { recordPaymentAuditEvent, rublesToKopecks } from '@/lib/audit/payment-events'
import {
  formatRubles,
  isValidPaymentAmount,
  MAX_PAYMENT_AMOUNT_RUB,
  MIN_PAYMENT_AMOUNT_RUB,
  normalizeCustomerEmail,
  normalizePaymentAmount,
  validateCustomerEmail,
} from '@/lib/payments/catalog'
import { paymentConfig } from '@/lib/payments/config'
import { buildPersonalDataConsentSnapshot } from '@/lib/legal/personal-data'
import { chargeWithSavedCard } from '@/lib/payments/provider'
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
  const rateLimitResponse = enforceRateLimit(
    request,
    'payments:charge-token',
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
    return Response.json(
      { error: 'One-click payments are unavailable in mock mode.' },
      { status: 503 },
    )
  }

  const rawBody = await request.text()
  const ip = getClientIp(request)

  return withIdempotency(request, 'payments:charge-token', rawBody, async () => {
    let body: {
      amountRub?: number | string
      customerEmail?: string
      personalDataConsentAccepted?: boolean
    }

    try {
      body = rawBody ? JSON.parse(rawBody) : {}
    } catch {
      return { status: 400, body: { error: 'Invalid request body.' } }
    }

    const amountRub = normalizePaymentAmount(Number(body.amountRub))
    const normalizedEmail = normalizeCustomerEmail(String(body.customerEmail || ''))
    const emailValidation = validateCustomerEmail(normalizedEmail)

    if (!isValidPaymentAmount(amountRub)) {
      await appendCheckoutTelemetryEvent({
        type: 'one_click_rejected',
        amountRub,
        email: normalizedEmail,
        emailValid: emailValidation.ok,
        reason: 'invalid_amount',
        path: '/api/payments/charge-token',
        userAgent: request.headers.get('user-agent') || undefined,
        ip,
      })

      return {
        status: 400,
        body: {
          error: `Введите сумму от ${formatRubles(MIN_PAYMENT_AMOUNT_RUB)} до ${formatRubles(MAX_PAYMENT_AMOUNT_RUB)} ₽.`,
        },
      }
    }

    if (!emailValidation.ok) {
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

    const result = await chargeWithSavedCard({
      amountRub,
      customerEmail: emailValidation.email,
      ipAddress: ip === 'unknown' ? undefined : ip,
      personalDataConsent: buildPersonalDataConsentSnapshot({
        ipAddress: ip === 'unknown' ? undefined : ip,
        userAgent: request.headers.get('user-agent') || undefined,
      }),
    })

    if (result.kind === 'no_saved_card') {
      return {
        status: 404,
        body: { error: 'Сохранённая карта не найдена. Оплатите обычным способом.' },
      }
    }

    const auditCommonFields = {
      customerEmail: emailValidation.email,
      clientIp: ip === 'unknown' ? null : ip,
      userAgent: request.headers.get('user-agent') || null,
      amountKopecks: rublesToKopecks(amountRub),
      actor: 'user' as const,
      idempotencyKey: request.headers.get('idempotency-key') || null,
    }

    if (result.kind === 'paid') {
      await appendCheckoutTelemetryEvent({
        type: 'one_click_paid',
        amountRub,
        email: emailValidation.email,
        emailValid: true,
        invoiceId: result.order.invoiceId,
        path: '/api/payments/charge-token',
        userAgent: request.headers.get('user-agent') || undefined,
        ip,
      })

      await recordPaymentAuditEvent({
        ...auditCommonFields,
        eventType: 'charge_token.succeeded',
        invoiceId: result.order.invoiceId,
        toStatus: result.order.status,
        payload: { provider: 'cloudpayments' },
      })

      return {
        status: 200,
        body: { order: result.order, status: 'paid' },
      }
    }

    if (result.kind === 'requires_3ds') {
      await appendCheckoutTelemetryEvent({
        type: 'one_click_requires_3ds',
        amountRub,
        email: emailValidation.email,
        emailValid: true,
        invoiceId: result.order.invoiceId,
        reason: '3ds_required',
        path: '/api/payments/charge-token',
        userAgent: request.headers.get('user-agent') || undefined,
        ip,
      })

      await recordPaymentAuditEvent({
        ...auditCommonFields,
        eventType: 'charge_token.requires_3ds',
        invoiceId: result.order.invoiceId,
        toStatus: result.order.status,
        payload: {
          transactionId: result.threeDs.transactionId,
          acsUrl: result.threeDs.acsUrl,
        },
      })

      return {
        status: 200,
        body: {
          order: result.order,
          status: 'requires_3ds',
          threeDs: {
            acsUrl: result.threeDs.acsUrl,
            paReq: result.threeDs.paReq,
            transactionId: result.threeDs.transactionId,
            // TermUrl возвращает пользователя на наш callback; PaRes / MD
            // приходят POST'ом от банка, finalize вызывает CloudPayments
            // /payments/cards/post3ds на стороне сервера.
            termUrl: `${new URL(request.url).origin}/api/payments/3ds-callback?invoiceId=${encodeURIComponent(result.order.invoiceId)}`,
          },
        },
      }
    }

    await appendCheckoutTelemetryEvent({
      type: 'one_click_declined',
      amountRub,
      email: emailValidation.email,
      emailValid: true,
      invoiceId: result.order.invoiceId,
      reason: result.reason,
      path: '/api/payments/charge-token',
      userAgent: request.headers.get('user-agent') || undefined,
      ip,
    })

    await recordPaymentAuditEvent({
      ...auditCommonFields,
      eventType: 'charge_token.declined',
      invoiceId: result.order.invoiceId,
      toStatus: result.order.status,
      payload: { reason: result.reason },
    })

    return {
      status: 402,
      body: {
        order: result.order,
        status: 'declined',
        message: result.reason,
      },
    }
  })
}
