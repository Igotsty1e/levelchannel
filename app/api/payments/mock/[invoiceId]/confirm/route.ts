import { NextResponse } from 'next/server'

import { paymentConfig } from '@/lib/payments/config'
import { markOrderPaid } from '@/lib/payments/provider'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
  isValidInvoiceId,
} from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  request: Request,
  context: { params: Promise<{ invoiceId: string }> },
) {
  const rateLimitResponse = enforceRateLimit(request, 'payments:mock-confirm', 20, 60_000)
  if (rateLimitResponse) {
    return rateLimitResponse
  }

  const originResponse = enforceTrustedBrowserOrigin(request)
  if (originResponse) {
    return originResponse
  }

  if (!paymentConfig.allowMockConfirm) {
    return NextResponse.json({ error: 'Mock confirmation is disabled.' }, { status: 403 })
  }

  const { invoiceId } = await context.params

  if (!isValidInvoiceId(invoiceId)) {
    return NextResponse.json({ error: 'Invalid payment id.' }, { status: 400 })
  }

  const order = await markOrderPaid(invoiceId, { source: 'mock.manual_confirm' })

  if (!order) {
    return NextResponse.json({ error: 'Payment not found.' }, { status: 404 })
  }

  return NextResponse.json(
    { ok: true },
    { headers: { 'Cache-Control': 'no-store, max-age=0' } },
  )
}
