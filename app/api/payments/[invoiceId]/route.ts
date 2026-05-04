import { NextResponse } from 'next/server'

import { getPublicPayment } from '@/lib/payments/provider'
import { enforceRateLimit, isValidInvoiceId } from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  request: Request,
  context: { params: Promise<{ invoiceId: string }> },
) {
  const rateLimitResponse = await enforceRateLimit(request, 'payments:status', 60, 60_000)
  if (rateLimitResponse) {
    return rateLimitResponse
  }

  const { invoiceId } = await context.params

  if (!isValidInvoiceId(invoiceId)) {
    return NextResponse.json({ error: 'Invalid payment id.' }, { status: 400 })
  }

  const order = await getPublicPayment(invoiceId)

  if (!order) {
    return NextResponse.json({ error: 'Payment not found.' }, { status: 404 })
  }

  return NextResponse.json(
    { order },
    {
      headers: {
        'Cache-Control': 'no-store, max-age=0',
      },
    },
  )
}
