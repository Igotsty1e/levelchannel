import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { POST as gatewayRefundHandler } from '@/app/api/admin/refunds/gateway-initiated/route'
import { POST as loginHandler } from '@/app/api/auth/login/route'
import { POST as registerHandler } from '@/app/api/auth/register/route'
import {
  getAccountByEmail,
  grantAccountRole,
  markAccountVerified,
} from '@/lib/auth/accounts'
import { getDbPool } from '@/lib/db/pool'

import '../setup'
import { buildRequest, extractSessionCookie, freshInvoiceId } from '../helpers'

// Wave 60 — gateway-initiated refund via CloudPayments API + Wave 60
// follow-up (Codex HIGH #2 / MEDIUM #3 / MEDIUM #4 / MEDIUM #6).
//
// Behind feature flag BILLING_REFUND_GATEWAY_ENABLED. Mock global
// `fetch` so we don't hit api.cloudpayments.ru; the endpoint reads
// provider_transaction_id from payment_orders and calls the stubbed
// fetch.

const ORIGINAL_FETCH = global.fetch

function mockCpRefund(payload: Record<string, unknown>) {
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString()
    if (url.includes('api.cloudpayments.ru/payments/refund')) {
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return new Response('not mocked', { status: 500 })
  }) as typeof global.fetch
}

function mockCpNetworkError() {
  global.fetch = vi.fn(async () => {
    throw new Error('Network is unreachable')
  }) as typeof global.fetch
}

beforeAll(() => {
  vi.stubEnv('BILLING_REFUND_GATEWAY_ENABLED', 'true')
  vi.stubEnv('CLOUDPAYMENTS_PUBLIC_ID', 'test-public-id')
  vi.stubEnv('CLOUDPAYMENTS_API_SECRET', 'test-api-secret')
})

afterAll(() => {
  vi.unstubAllEnvs()
  global.fetch = ORIGINAL_FETCH
})

afterEach(() => {
  global.fetch = ORIGINAL_FETCH
})

async function regAdmin() {
  const email = `gw-refund-admin-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`
  const password = 'StrongPassword123'
  await registerHandler(
    buildRequest('/api/auth/register', {
      body: { email, password, personalDataConsentAccepted: true },
    }),
  )
  const created = await getAccountByEmail(email)
  await markAccountVerified(created!.id)
  await grantAccountRole(created!.id, 'admin', null)
  const login = await loginHandler(
    buildRequest('/api/auth/login', { body: { email, password } }),
  )
  return {
    cookie: extractSessionCookie(login.headers.get('Set-Cookie'))!,
    accountId: created!.id,
  }
}

async function seedPaidAllocationWithTx(opts: {
  amountKopecks: number
  slotId: string
  withTransactionId?: boolean
}): Promise<{ paymentOrderId: string }> {
  const pool = getDbPool()
  const invoiceId = freshInvoiceId('lc_gw_refund')
  const txId = opts.withTransactionId === false ? null : 'cp-tx-9999'
  await pool.query(
    `insert into payment_orders
       (invoice_id, amount_rub, currency, description, provider, status,
        created_at, updated_at, paid_at, customer_email, receipt_email,
        receipt, provider_transaction_id)
     values ($1, $2, 'RUB', 'gateway refund test', 'mock', 'paid',
             now(), now(), now(), $3, $3, '{}'::jsonb, $4)`,
    [invoiceId, (opts.amountKopecks / 100).toFixed(2), 'gw@example.com', txId],
  )
  await pool.query(
    `insert into payment_allocations
       (payment_order_id, kind, target_id, amount_kopecks)
     values ($1, 'lesson_slot', $2, $3)`,
    [invoiceId, opts.slotId, opts.amountKopecks],
  )
  return { paymentOrderId: invoiceId }
}

async function fetchAttempt(attemptId: string) {
  const pool = getDbPool()
  const r = await pool.query(
    `select id, status, gateway_refund_transaction_id, gateway_message,
            gateway_reason_code, reversal_id, idempotency_key
       from payment_refund_attempts where id = $1`,
    [attemptId],
  )
  return r.rows[0] ?? null
}

async function fetchAuditFor(invoiceId: string) {
  const pool = getDbPool()
  const r = await pool.query(
    `select event_type, payload
       from payment_audit_events
      where invoice_id = $1 and event_type = 'payment.refund.initiated.gateway'
      order by created_at desc
      limit 1`,
    [invoiceId],
  )
  return r.rows[0] ?? null
}

describe('POST /api/admin/refunds/gateway-initiated', () => {
  it('returns 503 when BILLING_REFUND_GATEWAY_ENABLED is not set', async () => {
    vi.stubEnv('BILLING_REFUND_GATEWAY_ENABLED', '')
    try {
      const admin = await regAdmin()
      const res = await gatewayRefundHandler(
        buildRequest('/api/admin/refunds/gateway-initiated', {
          cookie: admin.cookie,
          body: {
            paymentOrderId: 'lc_test',
            kind: 'lesson_slot',
            targetId: '11111111-1111-1111-1111-111111111111',
            refundedKopecks: 1000,
          },
        }),
      )
      expect(res.status).toBe(503)
      expect((await res.json()).error).toBe('gateway_refund_disabled')
    } finally {
      vi.stubEnv('BILLING_REFUND_GATEWAY_ENABLED', 'true')
    }
  })

  it('on CP Success=true books the reversal + attempt=succeeded + audit row', async () => {
    mockCpRefund({
      Success: true,
      Model: { TransactionId: '7777777' },
    })
    const admin = await regAdmin()
    const slotId =
      'aaaaaaaa-aaaa-aaaa-aaaa-' +
      Date.now().toString(16).padStart(12, '0').slice(-12)
    const { paymentOrderId } = await seedPaidAllocationWithTx({
      amountKopecks: 350000,
      slotId,
    })
    const res = await gatewayRefundHandler(
      buildRequest('/api/admin/refunds/gateway-initiated', {
        cookie: admin.cookie,
        body: {
          paymentOrderId,
          kind: 'lesson_slot',
          targetId: slotId,
          refundedKopecks: 350000,
          reason: 'test gateway refund',
        },
      }),
    )
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.reversal).toBeDefined()
    expect(json.reversal.refundedKopecks).toBe(350000)
    expect(json.gatewayRefundTransactionId).toBe('7777777')
    expect(json.attemptId).toBeDefined()

    // Attempt row terminal=succeeded
    const attempt = await fetchAttempt(json.attemptId)
    expect(attempt.status).toBe('succeeded')
    expect(attempt.gateway_refund_transaction_id).toBe('7777777')
    expect(attempt.reversal_id).toBe(json.reversal.id)
    // Audit row exists with outcome=success
    const audit = await fetchAuditFor(paymentOrderId)
    expect(audit).not.toBeNull()
    expect(audit.payload.outcome).toBe('success')
    expect(audit.payload.gatewayRefundTransactionId).toBe('7777777')
  })

  it('on CP Success=false returns 502 + attempt=declined + audit row', async () => {
    mockCpRefund({
      Success: false,
      Message: 'Insufficient funds for refund',
      Model: { TransactionId: '7777777', ReasonCode: '5051' },
    })
    const admin = await regAdmin()
    const slotId =
      'bbbbbbbb-bbbb-bbbb-bbbb-' +
      Date.now().toString(16).padStart(12, '0').slice(-12)
    const { paymentOrderId } = await seedPaidAllocationWithTx({
      amountKopecks: 100000,
      slotId,
    })
    const res = await gatewayRefundHandler(
      buildRequest('/api/admin/refunds/gateway-initiated', {
        cookie: admin.cookie,
        body: {
          paymentOrderId,
          kind: 'lesson_slot',
          targetId: slotId,
          refundedKopecks: 100000,
        },
      }),
    )
    expect(res.status).toBe(502)
    const json = await res.json()
    expect(json.error).toBe('gateway_declined')
    expect(json.cpReasonCode).toBe('5051')
    expect(json.attemptId).toBeDefined()

    // No reversal in DB.
    const pool = getDbPool()
    const rowsAfter = await pool.query(
      `select id from payment_allocation_reversals
        where payment_order_id = $1 and kind = $2 and target_id = $3`,
      [paymentOrderId, 'lesson_slot', slotId],
    )
    expect(rowsAfter.rows.length).toBe(0)
    // Attempt terminal=declined
    const attempt = await fetchAttempt(json.attemptId)
    expect(attempt.status).toBe('declined')
    expect(attempt.gateway_reason_code).toBe('5051')
    // Audit captured outcome=declined
    const audit = await fetchAuditFor(paymentOrderId)
    expect(audit.payload.outcome).toBe('declined')
  })

  it('on fetch network error returns 503 gateway_error + attempt=error + audit row', async () => {
    mockCpNetworkError()
    const admin = await regAdmin()
    const slotId =
      'eeeeeeee-eeee-eeee-eeee-' +
      Date.now().toString(16).padStart(12, '0').slice(-12)
    const { paymentOrderId } = await seedPaidAllocationWithTx({
      amountKopecks: 100000,
      slotId,
    })
    const res = await gatewayRefundHandler(
      buildRequest('/api/admin/refunds/gateway-initiated', {
        cookie: admin.cookie,
        body: {
          paymentOrderId,
          kind: 'lesson_slot',
          targetId: slotId,
          refundedKopecks: 100000,
        },
      }),
    )
    expect(res.status).toBe(503)
    const json = await res.json()
    expect(json.error).toBe('gateway_error')
    expect(json.attemptId).toBeDefined()
    const attempt = await fetchAttempt(json.attemptId)
    expect(attempt.status).toBe('error')
    const audit = await fetchAuditFor(paymentOrderId)
    expect(audit.payload.outcome).toBe('error')
  })

  it('on malformed CP Success=true without TransactionId → gateway_error (defensive parse)', async () => {
    mockCpRefund({
      Success: true,
      Model: {}, // no TransactionId — should be treated as error, not success
    })
    const admin = await regAdmin()
    const slotId =
      'ffffffff-ffff-ffff-ffff-' +
      Date.now().toString(16).padStart(12, '0').slice(-12)
    const { paymentOrderId } = await seedPaidAllocationWithTx({
      amountKopecks: 100000,
      slotId,
    })
    const res = await gatewayRefundHandler(
      buildRequest('/api/admin/refunds/gateway-initiated', {
        cookie: admin.cookie,
        body: {
          paymentOrderId,
          kind: 'lesson_slot',
          targetId: slotId,
          refundedKopecks: 100000,
        },
      }),
    )
    expect(res.status).toBe(503)
    const json = await res.json()
    expect(json.error).toBe('gateway_error')
    // No reversal row.
    const pool = getDbPool()
    const rev = await pool.query(
      `select id from payment_allocation_reversals
        where payment_order_id = $1 and kind = $2 and target_id = $3`,
      [paymentOrderId, 'lesson_slot', slotId],
    )
    expect(rev.rows.length).toBe(0)
  })

  it('Idempotency-Key replay: second call with same key does NOT re-fire CP', async () => {
    let fetchCalls = 0
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.includes('api.cloudpayments.ru/payments/refund')) {
        fetchCalls++
        return new Response(
          JSON.stringify({ Success: true, Model: { TransactionId: '8888' } }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        )
      }
      return new Response('not mocked', { status: 500 })
    }) as typeof global.fetch

    const admin = await regAdmin()
    const slotId =
      '99999999-9999-9999-9999-' +
      Date.now().toString(16).padStart(12, '0').slice(-12)
    const { paymentOrderId } = await seedPaidAllocationWithTx({
      amountKopecks: 100000,
      slotId,
    })
    const key = `replay-key-${Date.now()}-${Math.floor(Math.random() * 1e6)}`

    const r1 = await gatewayRefundHandler(
      buildRequest('/api/admin/refunds/gateway-initiated', {
        cookie: admin.cookie,
        headers: { 'Idempotency-Key': key },
        body: {
          paymentOrderId,
          kind: 'lesson_slot',
          targetId: slotId,
          refundedKopecks: 100000,
        },
      }),
    )
    expect(r1.status).toBe(201)
    expect(fetchCalls).toBe(1)

    const r2 = await gatewayRefundHandler(
      buildRequest('/api/admin/refunds/gateway-initiated', {
        cookie: admin.cookie,
        headers: { 'Idempotency-Key': key },
        body: {
          paymentOrderId,
          kind: 'lesson_slot',
          targetId: slotId,
          refundedKopecks: 100000,
        },
      }),
    )
    // Replay → same status code as the original (201), no new CP call.
    expect(r2.status).toBe(201)
    expect(fetchCalls).toBe(1)
    const json2 = await r2.json()
    expect(json2.replay).toBe(true)
    expect(json2.attempt.status).toBe('succeeded')
  })

  it('returns 422 no_transaction_id when the order has no provider_transaction_id', async () => {
    const admin = await regAdmin()
    const slotId =
      'cccccccc-cccc-cccc-cccc-' +
      Date.now().toString(16).padStart(12, '0').slice(-12)
    const { paymentOrderId } = await seedPaidAllocationWithTx({
      amountKopecks: 100000,
      slotId,
      withTransactionId: false,
    })
    const res = await gatewayRefundHandler(
      buildRequest('/api/admin/refunds/gateway-initiated', {
        cookie: admin.cookie,
        body: {
          paymentOrderId,
          kind: 'lesson_slot',
          targetId: slotId,
          refundedKopecks: 100000,
        },
      }),
    )
    expect(res.status).toBe(422)
    expect((await res.json()).error).toBe('no_transaction_id')
  })

  it('rejects refundedKopecks > remaining (partial-then-overshoot)', async () => {
    mockCpRefund({
      Success: true,
      Model: { TransactionId: 'tx-partial-1' },
    })
    const admin = await regAdmin()
    const slotId =
      'dddddddd-dddd-dddd-dddd-' +
      Date.now().toString(16).padStart(12, '0').slice(-12)
    const { paymentOrderId } = await seedPaidAllocationWithTx({
      amountKopecks: 100000,
      slotId,
    })
    // First partial: 70k of 100k — succeeds.
    const r1 = await gatewayRefundHandler(
      buildRequest('/api/admin/refunds/gateway-initiated', {
        cookie: admin.cookie,
        body: {
          paymentOrderId,
          kind: 'lesson_slot',
          targetId: slotId,
          refundedKopecks: 70000,
        },
      }),
    )
    expect(r1.status).toBe(201)
    // Second refund: 50k — would push SUM to 120k > 100k. Rejected
    // BEFORE the CP call (no fetch invocation expected).
    const fetchSpy = vi.fn() as unknown as typeof global.fetch
    global.fetch = fetchSpy
    const r2 = await gatewayRefundHandler(
      buildRequest('/api/admin/refunds/gateway-initiated', {
        cookie: admin.cookie,
        body: {
          paymentOrderId,
          kind: 'lesson_slot',
          targetId: slotId,
          refundedKopecks: 50000,
        },
      }),
    )
    expect(r2.status).toBe(400)
    expect((await r2.json()).error).toBe('refund_exceeds_allocation')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("rejects kind='package' with 400 unsupported_kind", async () => {
    const admin = await regAdmin()
    const res = await gatewayRefundHandler(
      buildRequest('/api/admin/refunds/gateway-initiated', {
        cookie: admin.cookie,
        body: {
          paymentOrderId: 'lc_test',
          kind: 'package',
          targetId: '00000000-0000-0000-0000-000000000000',
          refundedKopecks: 1000,
        },
      }),
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('unsupported_kind')
  })
})
