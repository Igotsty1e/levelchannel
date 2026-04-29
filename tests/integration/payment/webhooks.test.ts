import { describe, expect, it } from 'vitest'

import { POST as failHandler } from '@/app/api/payments/webhooks/cloudpayments/fail/route'
import { POST as payHandler } from '@/app/api/payments/webhooks/cloudpayments/pay/route'
import { listPaymentAuditEventsByInvoice } from '@/lib/audit/payment-events'
import { getDbPool } from '@/lib/db/pool'

import './setup'
import { buildCloudPaymentsBody, signCloudPaymentsBody } from './sign'

// End-to-end CloudPayments webhook coverage (Pay + Fail). Real Postgres,
// real HMAC verify (signed test-side with CLOUDPAYMENTS_API_SECRET set
// in tests/setup-env.ts). Check webhook is exercised by the
// validation_failed branch of the pay flow — same wrapper code path.
//
// Signed body uses urlencoded form (CP's default), HMAC base64 sent
// via the X-Content-HMAC header which is what handleCloudPaymentsWebhook
// reads.

function buildPayWebhookRequest(rawBody: string) {
  const sig = signCloudPaymentsBody(rawBody)
  return new Request('http://localhost:3000/api/payments/webhooks/cloudpayments/pay', {
    method: 'POST',
    body: rawBody,
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-content-hmac': sig,
    },
  })
}

function buildFailWebhookRequest(rawBody: string) {
  const sig = signCloudPaymentsBody(rawBody)
  return new Request('http://localhost:3000/api/payments/webhooks/cloudpayments/fail', {
    method: 'POST',
    body: rawBody,
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-content-hmac': sig,
    },
  })
}

// We can't use `createHandler` to seed the order: TEST_INTEGRATION
// mode runs with PAYMENTS_PROVIDER=mock, which makes createPayment
// stamp orders as `provider='mock'`. The webhook validation path
// (lib/payments/cloudpayments-webhook.ts) refuses non-cloudpayments
// orders with code 10 (`Order provider mismatch`). We INSERT directly
// so the order looks like one CloudPayments would have created in
// production.
async function createOrder(amountRub: number, email: string) {
  const invoiceId = `lc_test_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
  await getDbPool().query(
    `insert into payment_orders (
       invoice_id, amount_rub, currency, description, provider, status,
       created_at, updated_at, customer_email, receipt_email, receipt
     ) values (
       $1, $2, 'RUB', 'Webhook integration test', 'cloudpayments', 'pending',
       now(), now(), $3, $3, '{}'::jsonb
     )`,
    [invoiceId, amountRub, email],
  )

  // Mirror the canonical 'order.created' audit event so subsequent
  // assertions about "what happened to this invoice" match production
  // shape.
  const { recordPaymentAuditEvent, rublesToKopecks } = await import(
    '@/lib/audit/payment-events'
  )
  await recordPaymentAuditEvent({
    eventType: 'order.created',
    invoiceId,
    customerEmail: email,
    amountKopecks: rublesToKopecks(amountRub),
    toStatus: 'pending',
    actor: 'user',
    payload: { provider: 'cloudpayments', testFixture: true },
  })

  return invoiceId
}

async function readOrderStatus(invoiceId: string): Promise<string | null> {
  const { rows } = await getDbPool().query(
    `select status from payment_orders where invoice_id = $1`,
    [invoiceId],
  )
  return rows[0]?.status ?? null
}

describe('POST /api/payments/webhooks/cloudpayments/pay', () => {
  it('marks order paid + writes received and processed audit events on a valid signed webhook', async () => {
    const invoiceId = await createOrder(1500, 'pay-wh@example.com')

    const body = buildCloudPaymentsBody({
      InvoiceId: invoiceId,
      Amount: '1500',
      Email: 'pay-wh@example.com',
      TransactionId: 999111,
      PaymentMethod: 'CardPayment',
      Status: 'Completed',
    })

    const res = await payHandler(buildPayWebhookRequest(body))
    expect(res.status).toBe(200)
    const respBody = await res.json()
    expect(respBody).toEqual({ code: 0 })

    expect(await readOrderStatus(invoiceId)).toBe('paid')

    const events = await listPaymentAuditEventsByInvoice(invoiceId)
    const types = events.map((e) => e.eventType)
    expect(types).toContain('order.created')
    expect(types).toContain('webhook.pay.received')
    expect(types).toContain('webhook.pay.processed')

    const processed = events.find((e) => e.eventType === 'webhook.pay.processed')!
    expect(processed.toStatus).toBe('paid')
    expect(processed.actor).toBe('webhook:cloudpayments:pay')
  })

  it('rejects HMAC mismatch with 401 — no audit, order stays pending', async () => {
    const invoiceId = await createOrder(2000, 'pay-bad-sig@example.com')

    const body = buildCloudPaymentsBody({
      InvoiceId: invoiceId,
      Amount: '2000',
      Email: 'pay-bad-sig@example.com',
    })

    // Forge a wrong signature.
    const res = await payHandler(
      new Request('http://localhost:3000/api/payments/webhooks/cloudpayments/pay', {
        method: 'POST',
        body,
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'x-content-hmac': 'totally-wrong-signature',
        },
      }),
    )
    expect(res.status).toBe(401)

    expect(await readOrderStatus(invoiceId)).toBe('pending')

    const events = await listPaymentAuditEventsByInvoice(invoiceId)
    // Only the original creation row — no audit row was written for
    // the rejected webhook (HMAC fail short-circuits before audit).
    expect(events.map((e) => e.eventType)).toEqual(['order.created'])
  })

  it('writes pay.received + pay.validation_failed on amount mismatch (signed but invalid order)', async () => {
    const invoiceId = await createOrder(1000, 'pay-amt@example.com')

    const body = buildCloudPaymentsBody({
      InvoiceId: invoiceId,
      Amount: '9999', // server has 1000
      Email: 'pay-amt@example.com',
      TransactionId: 333,
    })

    const res = await payHandler(buildPayWebhookRequest(body))
    expect(res.status).toBe(200)
    const respBody = await res.json()
    expect(respBody.code).not.toBe(0) // CP code-12 amount mismatch

    expect(await readOrderStatus(invoiceId)).toBe('pending')

    const events = await listPaymentAuditEventsByInvoice(invoiceId)
    const types = events.map((e) => e.eventType)
    expect(types).toContain('webhook.pay.received')
    expect(types).toContain('webhook.pay.validation_failed')
    expect(types).not.toContain('webhook.pay.processed')

    const failed = events.find((e) => e.eventType === 'webhook.pay.validation_failed')!
    expect(failed.payload).toMatchObject({ code: 12 })
  })
})

describe('POST /api/payments/webhooks/cloudpayments/fail', () => {
  it('marks order failed + writes received and processed audit on a valid signed webhook', async () => {
    const invoiceId = await createOrder(500, 'fail-wh@example.com')

    const body = buildCloudPaymentsBody({
      InvoiceId: invoiceId,
      Amount: '500',
      Email: 'fail-wh@example.com',
      TransactionId: 777,
      Reason: 'Insufficient funds',
      ReasonCode: 5051,
    })

    const res = await failHandler(buildFailWebhookRequest(body))
    expect(res.status).toBe(200)
    expect((await res.json()).code).toBe(0)

    expect(await readOrderStatus(invoiceId)).toBe('failed')

    const events = await listPaymentAuditEventsByInvoice(invoiceId)
    const types = events.map((e) => e.eventType)
    expect(types).toContain('webhook.fail.received')
    expect(types).toContain('webhook.fail.processed')

    const processed = events.find((e) => e.eventType === 'webhook.fail.processed')!
    expect(processed.toStatus).toBe('failed')
    expect(processed.payload).toMatchObject({
      reason: 'Insufficient funds',
      reasonCode: '5051',
    })
  })
})
