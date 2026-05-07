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
  validateCustomerComment,
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
  const rateLimitResponse = await enforceRateLimit(request, 'payments:create', 10, 60_000)
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
      customerComment?: string | null
      // Phase 6: optional binding to a lesson_slot. The webhook
      // handler reads order.metadata.slotId on `paid` and writes a
      // payment_allocations row.
      slotId?: string | null
    }

    try {
      body = rawBody ? JSON.parse(rawBody) : {}
    } catch {
      return { status: 400, body: { error: 'Invalid request body.' } }
    }

    const amountRub = normalizePaymentAmount(Number(body.amountRub))
    const customerEmail = normalizeCustomerEmail(String(body.customerEmail || ''))
    const emailValidation = validateCustomerEmail(customerEmail)

    const commentValidation = validateCustomerComment(body.customerComment)
    if (!commentValidation.ok) {
      return { status: 400, body: { error: commentValidation.message } }
    }
    const customerComment = commentValidation.comment

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

    // Phase 6: shape-validate the optional slotId. UUIDs only; if
    // the caller supplied a malformed value we drop it silently
    // rather than 400 — the field is operator-side metadata, not a
    // user-facing parameter, and silently dropping is safer than
    // failing a money-moving call on a metadata typo.
    const UUID_PATTERN_LOCAL =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    const slotIdRaw = body.slotId
    const slotId =
      typeof slotIdRaw === 'string' && UUID_PATTERN_LOCAL.test(slotIdRaw)
        ? slotIdRaw
        : null

    try {
      const { order, checkoutIntent, receiptToken } = await createPayment(
        amountRub,
        emailValidation.email,
        {
          rememberCard: body.rememberCard === true,
          personalDataConsent: buildPersonalDataConsentSnapshot({
            ipAddress: getClientIp(request),
            userAgent: request.headers.get('user-agent') || undefined,
          }),
          customerComment,
          slotId,
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
          // Only include the comment in audit if non-empty — keeps the
          // jsonb compact and grep'able.
          ...(customerComment ? { customerComment } : {}),
        },
      })

      return {
        status: 200,
        // Wave 6.1 #4 Phase 1.5 — receiptToken is the plain (server-
        // generated, 32-byte random) token whose sha256 hash lives on
        // the row's `receipt_token_hash` column. Phase 2 will gate
        // `/api/payments/[invoiceId]/{,cancel,stream}` on it; for now
        // it's returned to the client so the UI can start threading
        // it ahead of the gate. Treat as confidential like a session
        // cookie — never log, never leak in URLs without HTTPS.
        body: { order, checkoutIntent, receiptToken },
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
