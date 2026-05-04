import { NextResponse } from 'next/server'

import { recordPaymentAuditEvent, rublesToKopecks } from '@/lib/audit/payment-events'
import { sendOperatorPaymentFailureNotification } from '@/lib/email/dispatch'
import { paymentConfig } from '@/lib/payments/config'
import { confirmThreeDsAndFinalize } from '@/lib/payments/provider'
import { getOrder } from '@/lib/payments/store'
import { appendCheckoutTelemetryEvent } from '@/lib/telemetry/store'
import {
  enforceRateLimit,
  getClientIp,
  isValidInvoiceId,
} from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Callback от ACS банка после прохождения 3-D Secure. Сюда POST'ит сам банк
// (не наш фронт), поэтому origin-check не применим. Защита:
// 1) invoiceId в query-параметре проверяется на формат;
// 2) ордер валидируется на наличие 3DS-state — иначе invalid_state;
// 3) PaRes отдаётся в CloudPayments /payments/cards/post3ds, и его
//    подлинность проверяет уже сама CP, а не мы.
//
// На выходе всегда 303 redirect — пользователь возвращается из ACS-окна
// на /thank-you (успех) или на главную с ?payment=failed (отказ).
export async function POST(request: Request) {
  const rateLimitResponse = await enforceRateLimit(
    request,
    'payments:3ds-callback',
    30,
    60_000,
  )
  if (rateLimitResponse) {
    return rateLimitResponse
  }

  const url = new URL(request.url)
  const invoiceId = url.searchParams.get('invoiceId') || ''

  if (!isValidInvoiceId(invoiceId)) {
    return redirectFailed(invoiceId)
  }

  let formData: FormData

  try {
    formData = await request.formData()
  } catch {
    return redirectFailed(invoiceId)
  }

  const md = String(formData.get('MD') || '')
  const paRes = String(formData.get('PaRes') || '')

  if (!paRes) {
    return redirectFailed(invoiceId)
  }

  await appendCheckoutTelemetryEvent({
    type: 'one_click_3ds_callback',
    invoiceId,
    path: '/api/payments/3ds-callback',
    userAgent: request.headers.get('user-agent') || undefined,
    ip: getClientIp(request),
    reason: md ? 'md_present' : 'md_missing',
  })

  const result = await confirmThreeDsAndFinalize({ invoiceId, paRes })

  // PublicPaymentOrder doesn't carry customerEmail (intentionally — it's
  // the client-facing shape). Re-fetch the full order for audit identity.
  // Skipped for unknown_invoice — there's nothing to bind to.
  const fullOrder = result.kind === 'unknown_invoice' ? null : await getOrder(invoiceId)
  const auditCommon =
    fullOrder
      ? {
          invoiceId: fullOrder.invoiceId,
          customerEmail: fullOrder.customerEmail,
          clientIp: getClientIp(request),
          userAgent: request.headers.get('user-agent') || null,
          amountKopecks: rublesToKopecks(fullOrder.amountRub),
          actor: 'user' as const,
        }
      : null

  if (auditCommon) {
    await recordPaymentAuditEvent({
      ...auditCommon,
      eventType: 'threeds.callback.received',
      payload: { mdPresent: !!md, kind: result.kind },
    })
  }

  if (result.kind === 'paid') {
    await appendCheckoutTelemetryEvent({
      type: 'one_click_3ds_paid',
      invoiceId: result.order.invoiceId,
      amountRub: result.order.amountRub,
      path: '/api/payments/3ds-callback',
      ip: getClientIp(request),
    })
    if (auditCommon) {
      await recordPaymentAuditEvent({
        ...auditCommon,
        eventType: 'threeds.confirmed',
        toStatus: result.order.status,
      })
    }
    return redirectThankYou(result.order.invoiceId)
  }

  if (result.kind === 'unknown_invoice') {
    return redirectFailed(invoiceId)
  }

  if (result.kind === 'invalid_state') {
    if (auditCommon) {
      await recordPaymentAuditEvent({
        ...auditCommon,
        eventType: 'threeds.declined',
        toStatus: result.order.status,
        payload: { reason: 'invalid_state' },
      })
    }
    return redirectFailed(invoiceId)
  }

  await appendCheckoutTelemetryEvent({
    type: 'one_click_3ds_declined',
    invoiceId,
    reason: result.reason,
    path: '/api/payments/3ds-callback',
    ip: getClientIp(request),
  })

  if (auditCommon) {
    await recordPaymentAuditEvent({
      ...auditCommon,
      eventType: 'threeds.declined',
      toStatus: result.order.status,
      payload: { reason: result.reason },
    })
  }

  // Per-event operator notification on 3DS decline. Best-effort: a
  // Resend outage cannot block the user redirect to /payment=failed.
  // PublicPaymentOrder doesn't carry e-mail / comment — pull from the
  // already-loaded `fullOrder`.
  if (fullOrder) {
    try {
      await sendOperatorPaymentFailureNotification({
        invoiceId: fullOrder.invoiceId,
        amountRub: fullOrder.amountRub,
        customerEmail: fullOrder.customerEmail,
        source: '3DS callback decline',
        reason: result.reason ?? null,
        customerComment: fullOrder.customerComment ?? null,
      })
    } catch (err) {
      console.warn('[notify] operator failure email failed:', {
        invoiceId: fullOrder.invoiceId,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return redirectFailed(invoiceId)
}

function redirectThankYou(invoiceId: string) {
  const target = `${paymentConfig.siteUrl}/thank-you?invoiceId=${encodeURIComponent(invoiceId)}`
  return NextResponse.redirect(target, { status: 303 })
}

function redirectFailed(invoiceId: string) {
  const target = invoiceId
    ? `${paymentConfig.siteUrl}/?payment=failed&invoiceId=${encodeURIComponent(invoiceId)}`
    : `${paymentConfig.siteUrl}/?payment=failed`
  return NextResponse.redirect(target, { status: 303 })
}
