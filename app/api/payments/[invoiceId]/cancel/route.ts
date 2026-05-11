import { NextResponse } from 'next/server'

import { recordPaymentAuditEvent, rublesToKopecks } from '@/lib/audit/payment-events'
import { markOrderCancelled } from '@/lib/payments/provider'
import {
  evaluateReceiptGate,
  extractReceiptToken,
} from '@/lib/payments/receipt-token-gate'
import { getOrder } from '@/lib/payments/store'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
  getClientIp,
  isValidInvoiceId,
} from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' }

export async function POST(
  request: Request,
  context: { params: Promise<{ invoiceId: string }> },
) {
  const rateLimitResponse = await enforceRateLimit(request, 'payments:cancel', 30, 60_000)
  if (rateLimitResponse) {
    return rateLimitResponse
  }

  const originResponse = enforceTrustedBrowserOrigin(request)
  if (originResponse) {
    return originResponse
  }

  const { invoiceId } = await context.params

  if (!isValidInvoiceId(invoiceId)) {
    return NextResponse.json(
      { error: 'invalid_invoice_id', message: 'Invalid payment id.' },
      { status: 400, headers: NO_STORE },
    )
  }

  // Wave 6.1 #4 Phase 2 — gate BEFORE markOrderCancelled. An attacker
  // with a known invoiceId but no token must not be able to flip a
  // pending order to cancelled.
  const existing = await getOrder(invoiceId)
  if (!existing) {
    return NextResponse.json(
      { error: 'not_found', message: 'Payment not found.' },
      { status: 404, headers: NO_STORE },
    )
  }
  const presented = extractReceiptToken(request)
  const verdict = evaluateReceiptGate(existing, presented)
  if (!verdict.ok) {
    return NextResponse.json(
      { error: 'not_found', message: 'Payment not found.' },
      { status: 401, headers: NO_STORE },
    )
  }

  const order = await markOrderCancelled(invoiceId, {
    source: 'client',
    reason: 'widget_closed',
  })

  if (!order) {
    return NextResponse.json(
      { error: 'not_found', message: 'Payment not found.' },
      { status: 404, headers: NO_STORE },
    )
  }

  await recordPaymentAuditEvent({
    eventType: 'order.cancelled',
    invoiceId: order.invoiceId,
    customerEmail: order.customerEmail,
    clientIp: getClientIp(request),
    userAgent: request.headers.get('user-agent') || null,
    amountKopecks: rublesToKopecks(order.amountRub),
    toStatus: order.status,
    actor: 'user',
    payload: {
      source: 'client',
      reason: 'widget_closed',
    },
  })

  return NextResponse.json(
    { ok: true },
    {
      headers: {
        'Cache-Control': 'no-store, max-age=0',
      },
    },
  )
}
