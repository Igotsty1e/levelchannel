import { afterAll, describe, expect, it } from 'vitest'

import { POST as cancelHandler } from '@/app/api/payments/[invoiceId]/cancel/route'
import { POST as mockConfirmHandler } from '@/app/api/payments/mock/[invoiceId]/confirm/route'
import { POST as createHandler } from '@/app/api/payments/route'
import { listPaymentAuditEventsByInvoice } from '@/lib/audit/payment-events'
import { getDbPool } from '@/lib/db/pool'

import { buildRequest } from '../helpers'
import './setup'

// End-to-end exercises against real Postgres + the route handlers
// invoked as functions. Uses TEST_INTEGRATION=1 → setup-env switches
// payment provider to mock, storage to postgres, allow-mock-confirm
// to true. CloudPayments credentials never get touched.
//
// What we cover:
//   - POST /api/payments creates an order + an audit row, returns 200
//     with checkoutIntent
//   - Idempotency-Key replay returns the cached body, sets
//     `Idempotency-Replay: true` and does NOT mint a second order or
//     a second audit row
//   - cancel + mock-confirm transition status correctly and write the
//     matching audit events
//
// What we don't cover here (separate suites or out of scope):
//   - HMAC-signed webhook handlers (need test-side signing tooling)
//   - charge-token / 3DS — provider=mock has no card-token storage
//   - file backend storage (tested via unit tests in tests/payments/)

afterAll(async () => {
  // Tests share the singleton pool with auth integration tests — we
  // do NOT close it here, that lets later suites in the same vitest
  // process keep using it. Process exit cleans up.
})

function buildCreateRequest(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return buildRequest('/api/payments', { body, headers })
}

async function readOrderRow(invoiceId: string) {
  const { rows } = await getDbPool().query(
    `select invoice_id, status, amount_rub::text as amount_rub,
            customer_email, provider
       from payment_orders where invoice_id = $1`,
    [invoiceId],
  )
  return rows[0] || null
}

describe('POST /api/payments — create + idempotency', () => {
  it('creates a payment order and writes an audit row', async () => {
    const res = await createHandler(
      buildCreateRequest({
        amountRub: 2500,
        customerEmail: 'pay-1@example.com',
        personalDataConsentAccepted: true,
        customerComment: 'тестовый комментарий',
      }),
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.order).toBeDefined()
    expect(body.order.amountRub).toBe(2500)
    expect(body.order.status).toBe('pending')
    expect(body.checkoutIntent).toBeDefined()

    const invoiceId = body.order.invoiceId as string
    expect(invoiceId).toMatch(/^lc_/)

    const row = await readOrderRow(invoiceId)
    expect(row).not.toBeNull()
    expect(row.status).toBe('pending')
    expect(row.customer_email).toBe('pay-1@example.com')

    const auditEvents = await listPaymentAuditEventsByInvoice(invoiceId)
    expect(auditEvents.map((e) => e.eventType)).toEqual(['order.created'])
    expect(auditEvents[0].toStatus).toBe('pending')
    expect(auditEvents[0].customerEmail).toBe('pay-1@example.com')
    expect(auditEvents[0].amountKopecks).toBe(250000)
    expect(auditEvents[0].payload).toMatchObject({
      customerComment: 'тестовый комментарий',
    })

    // Comment column persisted on the order itself.
    const { rows: cmtRows } = await getDbPool().query(
      `select customer_comment, description from payment_orders where invoice_id = $1`,
      [invoiceId],
    )
    expect(cmtRows[0].customer_comment).toBe('тестовый комментарий')
    // description includes both PAYMENT_DESCRIPTION + the comment + amount.
    expect(cmtRows[0].description).toContain('тестовый комментарий')
    expect(cmtRows[0].description.replace(/\s/g, '')).toContain('2500₽')
  })

  it('rejects an over-128-char comment with 400, no order created', async () => {
    const longComment = 'a'.repeat(129)
    const res = await createHandler(
      buildCreateRequest({
        amountRub: 2500,
        customerEmail: 'long-comment@example.com',
        personalDataConsentAccepted: true,
        customerComment: longComment,
      }),
    )
    expect(res.status).toBe(400)

    const { rows } = await getDbPool().query(
      `select count(*)::int as n from payment_orders where customer_email = $1`,
      ['long-comment@example.com'],
    )
    expect(rows[0].n).toBe(0)
  })

  it('strips control characters from comment before persist', async () => {
    const dirty = '\u0000хороший\u001bкомментарий\u007f'
    const res = await createHandler(
      buildCreateRequest({
        amountRub: 1000,
        customerEmail: 'ctrl-strip@example.com',
        personalDataConsentAccepted: true,
        customerComment: dirty,
      }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    const invoiceId = body.order.invoiceId as string

    const { rows } = await getDbPool().query(
      `select customer_comment from payment_orders where invoice_id = $1`,
      [invoiceId],
    )
    expect(rows[0].customer_comment).toBe('хорошийкомментарий')
  })

  it('rejects an out-of-range amount with 400 + telemetry, no order created', async () => {
    const res = await createHandler(
      buildCreateRequest({
        amountRub: 1, // below MIN_PAYMENT_AMOUNT_RUB
        customerEmail: 'reject@example.com',
        personalDataConsentAccepted: true,
      }),
    )
    expect(res.status).toBe(400)

    const { rows } = await getDbPool().query(
      `select count(*)::int as n from payment_orders where customer_email = $1`,
      ['reject@example.com'],
    )
    expect(rows[0].n).toBe(0)
  })

  it('rejects without consent flag', async () => {
    const res = await createHandler(
      buildCreateRequest({
        amountRub: 2500,
        customerEmail: 'noconsent@example.com',
        // personalDataConsentAccepted intentionally omitted
      }),
    )
    expect(res.status).toBe(400)

    const { rows } = await getDbPool().query(
      `select count(*)::int as n from payment_orders where customer_email = $1`,
      ['noconsent@example.com'],
    )
    expect(rows[0].n).toBe(0)
  })

  it('replays a cached response on repeat Idempotency-Key with same body', async () => {
    const idemKey = 'integration-idem-' + Date.now()
    const body = {
      amountRub: 1500,
      customerEmail: 'idem@example.com',
      personalDataConsentAccepted: true,
    }

    const first = await createHandler(
      buildCreateRequest(body, { 'idempotency-key': idemKey }),
    )
    expect(first.status).toBe(200)
    const firstBody = await first.json()
    const invoiceId = firstBody.order.invoiceId as string

    const replay = await createHandler(
      buildCreateRequest(body, { 'idempotency-key': idemKey }),
    )
    expect(replay.status).toBe(200)
    expect(replay.headers.get('Idempotency-Replay')).toBe('true')
    const replayBody = await replay.json()
    expect(replayBody.order.invoiceId).toBe(invoiceId)

    // Only one DB row, only one audit event — replay didn't double up.
    const { rows } = await getDbPool().query(
      `select count(*)::int as n from payment_orders where customer_email = $1`,
      ['idem@example.com'],
    )
    expect(rows[0].n).toBe(1)

    const auditEvents = await listPaymentAuditEventsByInvoice(invoiceId)
    expect(auditEvents.filter((e) => e.eventType === 'order.created')).toHaveLength(1)
  })
})

describe('POST /api/payments/[invoiceId]/cancel', () => {
  it('moves a pending order to cancelled and writes audit', async () => {
    // Create.
    const res = await createHandler(
      buildCreateRequest({
        amountRub: 2000,
        customerEmail: 'cancel@example.com',
        personalDataConsentAccepted: true,
      }),
    )
    const { order } = await res.json()
    const invoiceId = order.invoiceId as string

    // Cancel.
    const cancelRes = await cancelHandler(
      buildRequest(`/api/payments/${invoiceId}/cancel`, { body: {} }),
      { params: Promise.resolve({ invoiceId }) },
    )
    expect(cancelRes.status).toBe(200)

    const row = await readOrderRow(invoiceId)
    expect(row.status).toBe('cancelled')

    const auditEvents = await listPaymentAuditEventsByInvoice(invoiceId)
    expect(auditEvents.map((e) => e.eventType)).toEqual([
      'order.created',
      'order.cancelled',
    ])
    expect(auditEvents[1].toStatus).toBe('cancelled')
  })

  it('returns 404 for unknown invoice', async () => {
    const res = await cancelHandler(
      buildRequest('/api/payments/lc_nonexistent12345/cancel', { body: {} }),
      { params: Promise.resolve({ invoiceId: 'lc_nonexistent12345' }) },
    )
    expect(res.status).toBe(404)
  })

  it('rejects a malformed invoice id with 400', async () => {
    const res = await cancelHandler(
      buildRequest('/api/payments/not-a-valid-id/cancel', { body: {} }),
      { params: Promise.resolve({ invoiceId: 'not-a-valid-id' }) },
    )
    expect(res.status).toBe(400)
  })
})

describe('POST /api/payments/mock/[invoiceId]/confirm', () => {
  it('moves a pending order to paid and writes mock.confirmed audit', async () => {
    const res = await createHandler(
      buildCreateRequest({
        amountRub: 3000,
        customerEmail: 'mockpay@example.com',
        personalDataConsentAccepted: true,
      }),
    )
    const { order } = await res.json()
    const invoiceId = order.invoiceId as string

    const confirmRes = await mockConfirmHandler(
      buildRequest(`/api/payments/mock/${invoiceId}/confirm`, { body: {} }),
      { params: Promise.resolve({ invoiceId }) },
    )
    expect(confirmRes.status).toBe(200)

    const row = await readOrderRow(invoiceId)
    expect(row.status).toBe('paid')

    const auditEvents = await listPaymentAuditEventsByInvoice(invoiceId)
    expect(auditEvents.map((e) => e.eventType)).toEqual([
      'order.created',
      'mock.confirmed',
    ])
    expect(auditEvents[1].toStatus).toBe('paid')
    expect(auditEvents[1].actor).toBe('system')
  })
})
