import { NextResponse } from 'next/server'

import {
  recordPaymentAuditEvent,
  rublesToKopecks,
  type PaymentAuditEventType,
} from '@/lib/audit/payment-events'
import {
  getCloudPaymentsInvoiceId,
  parseCloudPaymentsPayload,
  validateCloudPaymentsOrder,
  verifyCloudPaymentsSignature,
  type CloudPaymentsWebhookPayload,
} from '@/lib/payments/cloudpayments-webhook'
import { getOrder } from '@/lib/payments/store'

type WebhookHandler = (payload: CloudPaymentsWebhookPayload) => Promise<void>

type WebhookKind = 'check' | 'pay' | 'fail'

// Audit event names per phase per kind. The pre-validation `received`
// phase fires after HMAC verify + parse (we have a payload we trust
// the SOURCE of) but BEFORE order cross-check (we haven't decided
// whether amount/email/status are consistent with our records).
const RECEIVED_EVENT: Record<WebhookKind, PaymentAuditEventType> = {
  check: 'webhook.check.received',
  pay: 'webhook.pay.received',
  fail: 'webhook.fail.received',
}

const VALIDATION_FAILED_EVENT: Record<WebhookKind, PaymentAuditEventType> = {
  check: 'webhook.check.declined',
  pay: 'webhook.pay.validation_failed',
  fail: 'webhook.fail.declined',
}

// HMAC and parse failures NEVER produce audit rows: at that point we
// don't trust the body's invoice_id. The audit table's invoice_id
// column has a FK on payment_orders, so writing a fabricated value
// would either fail or pollute the index.
//
// Cross-check (validateCloudPaymentsOrder) failures DO produce audit
// rows because we have a parsed payload from a verified-HMAC source —
// the invoice_id, even if it doesn't match a real order, is what
// CloudPayments said it was. We attach as much context as we can
// (look up the order; if not found, leave email/amount nulls and
// pass null invoice_id... actually no — FK requires a real order;
// so if order not found we can only console-warn, not audit).
//
// This trade-off is documented because it surprises: a fail webhook
// for an unknown invoice_id won't show up in audit, only in journald.
// The uptime/webhook-flow alerts catch the broader pattern.
export async function handleCloudPaymentsWebhook(
  request: Request,
  options: { kind: WebhookKind; handler?: WebhookHandler },
) {
  const rawBody = await request.text()
  const xContentHmac = request.headers.get('x-content-hmac')
  const contentHmac = request.headers.get('content-hmac')
  const contentType = request.headers.get('content-type')

  if (!verifyCloudPaymentsSignature(rawBody, xContentHmac, contentHmac)) {
    return NextResponse.json({ code: 13 }, { status: 401 })
  }

  let payload: CloudPaymentsWebhookPayload
  try {
    payload = parseCloudPaymentsPayload(rawBody, contentType)
  } catch {
    return NextResponse.json({ code: 13 }, { status: 400 })
  }

  // Phase 0: parsed payload, source verified. Audit the receipt — but
  // ONLY if the invoice_id matches a real order (FK constraint). If
  // the invoice is unknown, skip audit and let validation produce the
  // expected `code: <nonzero>` response; the unknown-invoice case is
  // expected and not worth a polluted audit row.
  const invoiceId = getCloudPaymentsInvoiceId(payload)
  const order = invoiceId ? await getOrder(invoiceId) : null

  if (order) {
    await recordPaymentAuditEvent({
      eventType: RECEIVED_EVENT[options.kind],
      invoiceId: order.invoiceId,
      customerEmail: order.customerEmail,
      amountKopecks: rublesToKopecks(order.amountRub),
      fromStatus: order.status,
      actor: `webhook:cloudpayments:${options.kind}`,
      payload: {
        transactionId: payload.TransactionId,
        amountInPayload: payload.Amount,
        emailInPayload: payload.Email,
      },
    })
  }

  const validation = await validateCloudPaymentsOrder(payload)
  if (!validation.ok) {
    if (order) {
      await recordPaymentAuditEvent({
        eventType: VALIDATION_FAILED_EVENT[options.kind],
        invoiceId: order.invoiceId,
        customerEmail: order.customerEmail,
        amountKopecks: rublesToKopecks(order.amountRub),
        fromStatus: order.status,
        actor: `webhook:cloudpayments:${options.kind}`,
        payload: { code: validation.code },
      })
    }
    return NextResponse.json({ code: validation.code })
  }

  if (options.handler) {
    await options.handler(payload)
  }

  return NextResponse.json({ code: 0 })
}
