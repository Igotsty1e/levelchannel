import { NextResponse } from 'next/server'

import { recordPaymentAuditEvent, rublesToKopecks } from '@/lib/audit/payment-events'
import { markOrderCancelled } from '@/lib/payments/provider'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
  getClientIp,
  isValidInvoiceId,
} from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  request: Request,
  context: { params: Promise<{ invoiceId: string }> },
) {
  const rateLimitResponse = enforceRateLimit(request, 'payments:cancel', 30, 60_000)
  if (rateLimitResponse) {
    return rateLimitResponse
  }

  const originResponse = enforceTrustedBrowserOrigin(request)
  if (originResponse) {
    return originResponse
  }

  const { invoiceId } = await context.params

  if (!isValidInvoiceId(invoiceId)) {
    return NextResponse.json({ error: 'Invalid payment id.' }, { status: 400 })
  }

  const order = await markOrderCancelled(invoiceId, {
    source: 'client',
    reason: 'widget_closed',
  })

  if (!order) {
    return NextResponse.json({ error: 'Payment not found.' }, { status: 404 })
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
