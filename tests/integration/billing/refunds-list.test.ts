import { describe, expect, it } from 'vitest'

import {
  POST as refundsHandler,
  GET as refundsListHandler,
} from '@/app/api/admin/refunds/route'
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

// Wave 64 — GET /api/admin/refunds listing endpoint.
//
// Pure read; admin role + rate-limit. Returns
// payment_allocation_reversals rows newest-first with operator email
// joined. The POST handler in the same route is exercised by
// `refunds.test.ts` and `refunds-gateway.test.ts`.

async function regAdmin() {
  const email = `refund-list-admin-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`
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
    email,
  }
}

async function seedPaidAllocation(opts: {
  amountKopecks: number
  slotId: string
}): Promise<{ paymentOrderId: string }> {
  const pool = getDbPool()
  const invoiceId = freshInvoiceId('lc_refund_list')
  await pool.query(
    `insert into payment_orders
       (invoice_id, amount_rub, currency, description, provider, status,
        created_at, updated_at, paid_at, customer_email, receipt_email, receipt)
     values ($1, $2, 'RUB', 'list test', 'mock', 'paid',
             now(), now(), now(), $3, $3, '{}'::jsonb)`,
    [invoiceId, (opts.amountKopecks / 100).toFixed(2), 'list@example.com'],
  )
  await pool.query(
    `insert into payment_allocations
       (payment_order_id, kind, target_id, amount_kopecks)
     values ($1, 'lesson_slot', $2, $3)`,
    [invoiceId, opts.slotId, opts.amountKopecks],
  )
  return { paymentOrderId: invoiceId }
}

async function bookOneRefund(
  cookie: string,
  paymentOrderId: string,
  slotId: string,
  refundedKopecks: number,
) {
  const res = await refundsHandler(
    buildRequest('/api/admin/refunds', {
      cookie,
      body: {
        paymentOrderId,
        kind: 'lesson_slot',
        targetId: slotId,
        refundedKopecks,
      },
    }),
  )
  expect(res.status).toBe(201)
}

describe('GET /api/admin/refunds', () => {
  it('returns reversals newest-first with operator email joined', async () => {
    const admin = await regAdmin()
    const slotId =
      '88888888-8888-8888-8888-' +
      Date.now().toString(16).padStart(12, '0').slice(-12)
    const { paymentOrderId } = await seedPaidAllocation({
      amountKopecks: 100000,
      slotId,
    })
    await bookOneRefund(admin.cookie, paymentOrderId, slotId, 100000)

    const res = await refundsListHandler(
      buildRequest('/api/admin/refunds', { cookie: admin.cookie }),
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(Array.isArray(json.rows)).toBe(true)

    const ours = json.rows.find(
      (r: { paymentOrderId: string; targetId: string }) =>
        r.paymentOrderId === paymentOrderId && r.targetId === slotId,
    )
    expect(ours).toBeDefined()
    expect(ours.refundedKopecks).toBe(100000)
    expect(ours.refundedByEmail).toBe(admin.email)
    expect(ours.kind).toBe('lesson_slot')
  })

  it('respects limit query param + caps at 500', async () => {
    const admin = await regAdmin()
    const res1 = await refundsListHandler(
      buildRequest('/api/admin/refunds?limit=3', { cookie: admin.cookie }),
    )
    expect(res1.status).toBe(200)
    const json1 = await res1.json()
    expect(json1.page.limit).toBe(3)
    expect(json1.rows.length).toBeLessThanOrEqual(3)

    // Garbage limit values clamp to default 50.
    const res2 = await refundsListHandler(
      buildRequest('/api/admin/refunds?limit=99999', { cookie: admin.cookie }),
    )
    const json2 = await res2.json()
    expect(json2.page.limit).toBe(500)

    const res3 = await refundsListHandler(
      buildRequest('/api/admin/refunds?limit=not-a-number', {
        cookie: admin.cookie,
      }),
    )
    const json3 = await res3.json()
    expect(json3.page.limit).toBe(50)
  })

  it('rejects unauthenticated callers with 401', async () => {
    const res = await refundsListHandler(
      buildRequest('/api/admin/refunds', {}),
    )
    expect(res.status).toBe(401)
  })
})
