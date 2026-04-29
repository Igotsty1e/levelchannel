import { NextResponse } from 'next/server'

import { paymentConfig } from '@/lib/payments/config'
import { confirmThreeDsAndFinalize } from '@/lib/payments/provider'
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
  const rateLimitResponse = enforceRateLimit(
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

  if (result.kind === 'paid') {
    await appendCheckoutTelemetryEvent({
      type: 'one_click_3ds_paid',
      invoiceId: result.order.invoiceId,
      amountRub: result.order.amountRub,
      path: '/api/payments/3ds-callback',
      ip: getClientIp(request),
    })
    return redirectThankYou(result.order.invoiceId)
  }

  if (result.kind === 'unknown_invoice') {
    return redirectFailed(invoiceId)
  }

  if (result.kind === 'invalid_state') {
    return redirectFailed(invoiceId)
  }

  await appendCheckoutTelemetryEvent({
    type: 'one_click_3ds_declined',
    invoiceId,
    reason: result.reason,
    path: '/api/payments/3ds-callback',
    ip: getClientIp(request),
  })

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
