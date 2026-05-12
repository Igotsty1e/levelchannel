import { NextResponse } from 'next/server'

import {
  evaluateReceiptGate,
  extractReceiptToken,
} from '@/lib/payments/receipt-token-gate'
import { NO_STORE } from '@/lib/api/http-headers'
import { syncMockOrderState, toPublicOrder } from '@/lib/payments/provider'
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
    return NextResponse.json(
      { error: 'invalid_invoice_id', message: 'Invalid payment id.' },
      { status: 400, headers: NO_STORE },
    )
  }

  // Wave 6.1 #4 Phase 2 — receipt token gate. We fetch the FULL order
  // (not the public projection) so the gate can read receiptTokenHash
  // + createdAt. On success we project to PublicPaymentOrder before
  // returning — the public shape never includes the hash.
  const order = await syncMockOrderState(invoiceId)
  if (!order) {
    return NextResponse.json(
      { error: 'not_found', message: 'Payment not found.' },
      { status: 404, headers: NO_STORE },
    )
  }

  const presented = extractReceiptToken(request)
  const verdict = evaluateReceiptGate(order, presented)
  if (!verdict.ok) {
    // Same body shape as not-found to avoid revealing whether an
    // invoiceId exists by the response code alone. 401 because
    // there IS a known capability to gate, even if we don't reveal it.
    return NextResponse.json(
      { error: 'not_found', message: 'Payment not found.' },
      { status: 401, headers: NO_STORE },
    )
  }

  return NextResponse.json(
    { order: toPublicOrder(order) },
    { headers: NO_STORE },
  )
}
