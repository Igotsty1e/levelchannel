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

// Wave 60 — gateway-initiated refund via CloudPayments API.
//
// Behind feature flag BILLING_REFUND_GATEWAY_ENABLED. Mock the global
// `fetch` so we don't actually hit api.cloudpayments.ru; the endpoint
// reads provider_transaction_id from payment_orders and calls the
// stubbed fetch.

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

beforeAll(() => {
  process.env.BILLING_WAVE_ACTIVE = 'true'
  process.env.BILLING_REFUND_GATEWAY_ENABLED = 'true'
  // The CP API helper checks credentials; satisfy the env so the
  // helper reaches the fetch call (mocked).
  process.env.CLOUDPAYMENTS_PUBLIC_ID = 'test-public-id'
  process.env.CLOUDPAYMENTS_API_SECRET = 'test-api-secret'
})

afterAll(() => {
  delete process.env.BILLING_WAVE_ACTIVE
  delete process.env.BILLING_REFUND_GATEWAY_ENABLED
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

describe('POST /api/admin/refunds/gateway-initiated', () => {
  it('returns 503 when BILLING_REFUND_GATEWAY_ENABLED is not set', async () => {
    delete process.env.BILLING_REFUND_GATEWAY_ENABLED
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
    process.env.BILLING_REFUND_GATEWAY_ENABLED = 'true' // restore for next tests
  })

  it('on CP Success=true books the reversal + returns gatewayRefundTransactionId', async () => {
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
    // DB has the reversal row.
    const pool = getDbPool()
    const rowsAfter = await pool.query(
      `select id from payment_allocation_reversals
        where payment_order_id = $1 and kind = $2 and target_id = $3`,
      [paymentOrderId, 'lesson_slot', slotId],
    )
    expect(rowsAfter.rows.length).toBe(1)
  })

  it('on CP Success=false returns 502 gateway_declined + does NOT book the reversal', async () => {
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
    // No reversal in DB.
    const pool = getDbPool()
    const rowsAfter = await pool.query(
      `select id from payment_allocation_reversals
        where payment_order_id = $1 and kind = $2 and target_id = $3`,
      [paymentOrderId, 'lesson_slot', slotId],
    )
    expect(rowsAfter.rows.length).toBe(0)
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
