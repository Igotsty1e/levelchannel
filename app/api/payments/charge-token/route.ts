import { recordPaymentAuditEvent, rublesToKopecks } from '@/lib/audit/payment-events'
import { getCurrentSession } from '@/lib/auth/sessions'
import {
  formatRubles,
  isValidPaymentAmount,
  MAX_PAYMENT_AMOUNT_RUB,
  MIN_PAYMENT_AMOUNT_RUB,
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
  const rateLimitResponse = await enforceRateLimit(
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

  // Codex 2026-05-07 (P0) — required session.
  //
  // Was: anonymous POST with `{customerEmail}` would charge the saved
  // card bound to that email. The token store is keyed by email, so an
  // attacker who knew the victim's email could trigger a charge against
  // their saved card (3-D Secure mitigates most banks but ANY
  // one-click-without-3DS card was fully exposed).
  //
  // Now: session is required, email comes from session.account.email,
  // body.customerEmail is ignored to avoid confused-deputy patterns.
  const session = await getCurrentSession(request)
  if (!session) {
    return Response.json(
      { error: 'Войдите в аккаунт, чтобы оплатить сохранённой картой.' },
      { status: 401 },
    )
  }
  const sessionEmailValidation = validateCustomerEmail(session.account.email)
  if (!sessionEmailValidation.ok) {
    return Response.json(
      { error: sessionEmailValidation.message },
      { status: 400 },
    )
  }
  const customerEmail = sessionEmailValidation.email

  const rawBody = await request.text()
  const ip = getClientIp(request)

  return withIdempotency(request, 'payments:charge-token', rawBody, async () => {
    let body: {
      amountRub?: number | string
      personalDataConsentAccepted?: boolean
    }

    try {
      body = rawBody ? JSON.parse(rawBody) : {}
    } catch {
      return { status: 400, body: { error: 'Invalid request body.' } }
    }

    const amountRub = normalizePaymentAmount(Number(body.amountRub))

    if (!isValidPaymentAmount(amountRub)) {
      await appendCheckoutTelemetryEvent({
        type: 'one_click_rejected',
        amountRub,
        email: customerEmail,
        emailValid: true,
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

    if (body.personalDataConsentAccepted !== true) {
      return {
        status: 400,
        body: { error: 'Подтвердите согласие на обработку персональных данных.' },
      }
    }

    let result: Awaited<ReturnType<typeof chargeWithSavedCard>>
    try {
      result = await chargeWithSavedCard({
        amountRub,
        customerEmail: customerEmail,
        ipAddress: ip === 'unknown' ? undefined : ip,
        personalDataConsent: buildPersonalDataConsentSnapshot({
          ipAddress: ip === 'unknown' ? undefined : ip,
          userAgent: request.headers.get('user-agent') || undefined,
        }),
      })
    } catch (err) {
      // Synchronous failure inside the charge path — most likely a CP
      // 5xx, network blip, or a provider-side schema mismatch. We DO
      // NOT have a guaranteed invoice_id here (chargeWithSavedCard
      // creates it internally and may throw before or after that),
      // so we can only log to journald via console.warn. This is a
      // gap relative to the post-success / post-decline events but
      // it's the honest accounting — see migration 0014 for why
      // charge_token.attempted isn't a separate audit row either.
      console.warn('[audit] charge_token sync error:', {
        email: customerEmail,
        amountRub,
        error: err instanceof Error ? err.message : String(err),
      })
      throw err
    }

    if (result.kind === 'no_saved_card') {
      return {
        status: 404,
        body: { error: 'Сохранённая карта не найдена. Оплатите обычным способом.' },
      }
    }

    const auditCommonFields = {
      customerEmail: customerEmail,
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
        email: customerEmail,
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
        email: customerEmail,
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
      email: customerEmail,
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
