import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { POST as checkoutPackageHandler } from '@/app/api/checkout/package/[slug]/route'
import { POST as loginHandler } from '@/app/api/auth/login/route'
import { POST as registerHandler } from '@/app/api/auth/register/route'
import { POST as payHandler } from '@/app/api/payments/webhooks/cloudpayments/pay/route'
import {
  getAccountByEmail,
  markAccountVerified,
} from '@/lib/auth/accounts'
import { listPaymentAuditEventsByInvoice } from '@/lib/audit/payment-events'
import { createPackage } from '@/lib/billing/packages'
import { getDbPool } from '@/lib/db/pool'

import '../setup'
import { buildRequest, extractSessionCookie } from '../helpers'
import { buildCloudPaymentsBody, signCloudPaymentsBody } from '../payment/sign'

// AUDIT-CODE-6 (2026-05-17) — full e2e wire-up coverage for the
// learner package-buy flow:
//
//   POST /api/checkout/package/[slug]   (cloudpayments provider,
//                                         status='pending')
//   POST /api/payments/webhooks/.../pay  (signed HMAC body)
//   → processPackageGrant dispatched
//   → package_purchases row appears
//   → payment_allocations row appears
//
// Mirrors the BCS-F.1 failure mode where each leg was unit-tested
// but the WIRE-UP step was missed. The webhook handler dispatches to
// processPackageGrant when order.metadata.packageSlug is set
// (app/api/payments/webhooks/cloudpayments/pay/route.ts:144). This
// test pins that dispatch end-to-end so a future regression where
// the webhook drops the dispatch can't pass CI.

beforeAll(() => {
  // CloudPayments provider so the buy route writes status='pending'
  // (NOT the mock auto-confirm path that fires processPackageGrant
  // inline). The webhook leg is what we're testing. Do NOT override
  // CLOUDPAYMENTS_API_SECRET — paymentConfig captures it at module
  // import time, so a late stub here would only patch the signer
  // while the webhook verifier keeps the test-env-defined value
  // ('test_api_secret' from tests/setup-env.ts), causing 401.
  vi.stubEnv('PAYMENTS_PROVIDER', 'cloudpayments')
  vi.stubEnv('PAYMENTS_ALLOW_MOCK_CONFIRM', '')
})

afterAll(() => {
  vi.unstubAllEnvs()
})

async function makeLearner(email: string) {
  const password = 'StrongPassword123'
  await registerHandler(
    buildRequest('/api/auth/register', {
      body: { email, password, personalDataConsentAccepted: true },
    }),
  )
  const acc = await getAccountByEmail(email)
  await markAccountVerified(acc!.id)
  const login = await loginHandler(
    buildRequest('/api/auth/login', { body: { email, password } }),
  )
  return {
    cookie: extractSessionCookie(login.headers.get('Set-Cookie'))!,
    accountId: acc!.id,
    email,
  }
}

function buildPayWebhookRequest(rawBody: string) {
  const sig = signCloudPaymentsBody(rawBody)
  return new Request(
    'http://localhost:3000/api/payments/webhooks/cloudpayments/pay',
    {
      method: 'POST',
      body: rawBody,
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-content-hmac': sig,
      },
    },
  )
}

describe('e2e: learner package buy → webhook → processPackageGrant → purchase', () => {
  it('full flow creates package_purchases + payment_allocations via webhook dispatch', async () => {
    const learner = await makeLearner('pkg-buy-e2e@example.com')
    const pkg = await createPackage({
      slug: `pkg-buy-e2e-${Date.now()}`,
      titleRu: 'E2E Pack',
      durationMinutes: 60,
      count: 5,
      amountKopecks: 150_00,
    })

    // Leg 1: buy init under cloudpayments provider → order pending,
    // metadata.packageSlug + metadata.accountId set, no package_purchases
    // row yet.
    const buyRes = await checkoutPackageHandler(
      buildRequest(`/api/checkout/package/${pkg.slug}`, {
        cookie: learner.cookie,
        body: {},
        headers: { 'Idempotency-Key': `e2e-${Date.now()}` },
      }),
      { params: Promise.resolve({ slug: pkg.slug }) },
    )
    expect(buyRes.status).toBe(200)
    const buyBody = await buyRes.json()
    expect(buyBody.provider).toBe('cloudpayments')
    expect(buyBody.status).toBe('pending')
    expect(buyBody.invoiceId).toBeTruthy()
    const invoiceId = buyBody.invoiceId as string

    const pool = getDbPool()
    // Order exists, packageSlug in metadata, status pending.
    const orderBefore = await pool.query(
      `select status, metadata, amount_rub from payment_orders where invoice_id = $1`,
      [invoiceId],
    )
    expect(orderBefore.rows[0].status).toBe('pending')
    expect(orderBefore.rows[0].metadata.packageSlug).toBe(pkg.slug)
    expect(orderBefore.rows[0].metadata.accountId).toBe(learner.accountId)

    // No purchase yet.
    const purchasesBefore = await pool.query(
      `select count(*)::int as c from package_purchases where account_id = $1`,
      [learner.accountId],
    )
    expect(purchasesBefore.rows[0].c).toBe(0)

    // Leg 2: signed CloudPayments pay webhook for this invoice.
    // The webhook handler MUST: mark paid + dispatch
    // processPackageGrant + create package_purchases +
    // payment_allocations.
    const webhookBody = buildCloudPaymentsBody({
      InvoiceId: invoiceId,
      Amount: '150',
      Email: learner.email,
      TransactionId: Math.floor(Math.random() * 1_000_000_000),
      PaymentMethod: 'CardPayment',
      Status: 'Completed',
    })
    const webhookRes = await payHandler(buildPayWebhookRequest(webhookBody))
    expect(webhookRes.status).toBe(200)
    const webhookRespBody = await webhookRes.json()
    expect(webhookRespBody).toEqual({ code: 0 })

    // Leg 3: state assertions — the wire-up actually fired.

    // 3a. Order flipped to paid.
    const orderAfter = await pool.query(
      `select status from payment_orders where invoice_id = $1`,
      [invoiceId],
    )
    expect(orderAfter.rows[0].status).toBe('paid')

    // 3b. package_purchases row appeared for the learner's package.
    // This is the load-bearing assertion: if the webhook handler
    // forgot to dispatch processPackageGrant (BCS-F.1 failure mode),
    // this row would not exist.
    const purchases = await pool.query(
      `select id, account_id, package_id, count_initial, title_snapshot,
              payment_order_id, duration_minutes, voided_at
         from package_purchases
        where payment_order_id = $1`,
      [invoiceId],
    )
    expect(purchases.rows.length).toBe(1)
    const purchase = purchases.rows[0]
    expect(purchase.account_id).toBe(learner.accountId)
    expect(purchase.package_id).toBe(pkg.id)
    expect(Number(purchase.count_initial)).toBe(5)
    expect(purchase.title_snapshot).toBe('E2E Pack')
    expect(Number(purchase.duration_minutes)).toBe(60)
    expect(purchase.voided_at).toBeNull()

    // 3c. payment_allocations row with kind='package' pointing at
    // the new purchase.
    const alloc = await pool.query(
      `select kind, target_id, amount_kopecks
         from payment_allocations
        where payment_order_id = $1`,
      [invoiceId],
    )
    expect(alloc.rows.length).toBe(1)
    expect(alloc.rows[0].kind).toBe('package')
    expect(alloc.rows[0].target_id).toBe(purchase.id)
    expect(Number(alloc.rows[0].amount_kopecks)).toBe(150_00)

    // 3d. Audit trail includes webhook.pay.processed + the grant
    // success event. If the webhook handler ran but didn't dispatch,
    // we'd see webhook.pay.processed but NOT the grant audit.
    const events = await listPaymentAuditEventsByInvoice(invoiceId)
    const types = events.map((e) => e.eventType)
    expect(types).toContain('webhook.pay.processed')
    expect(types).toContain('package.grant.succeeded')
  })

  it('webhook replay for same invoice → idempotent (no duplicate package_purchases)', async () => {
    // Real CP retries are routine. The webhook handler + processPackageGrant
    // are individually idempotent; this test pins the FULL replay
    // contract end-to-end.
    const learner = await makeLearner('pkg-buy-replay@example.com')
    const pkg = await createPackage({
      slug: `pkg-buy-replay-${Date.now()}`,
      titleRu: 'Replay Pack',
      durationMinutes: 60,
      count: 3,
      amountKopecks: 90_00,
    })
    const buyRes = await checkoutPackageHandler(
      buildRequest(`/api/checkout/package/${pkg.slug}`, {
        cookie: learner.cookie,
        body: {},
        headers: { 'Idempotency-Key': `e2e-replay-${Date.now()}` },
      }),
      { params: Promise.resolve({ slug: pkg.slug }) },
    )
    const buyBody = await buyRes.json()
    const invoiceId = buyBody.invoiceId as string

    const txId = Math.floor(Math.random() * 1_000_000_000)
    const webhookBody = buildCloudPaymentsBody({
      InvoiceId: invoiceId,
      Amount: '90',
      Email: learner.email,
      TransactionId: txId,
      PaymentMethod: 'CardPayment',
      Status: 'Completed',
    })

    // First delivery.
    const r1 = await payHandler(buildPayWebhookRequest(webhookBody))
    expect(r1.status).toBe(200)

    // Replay with same TransactionId — CP-side retry simulation.
    const r2 = await payHandler(buildPayWebhookRequest(webhookBody))
    expect(r2.status).toBe(200)
    // Replay carries the `Webhook-Replay: true` header (dedup hit).
    expect(r2.headers.get('Webhook-Replay')).toBe('true')

    // Exactly one package_purchases row regardless of replay count.
    const pool = getDbPool()
    const purchases = await pool.query(
      `select count(*)::int as c from package_purchases where payment_order_id = $1`,
      [invoiceId],
    )
    expect(purchases.rows[0].c).toBe(1)
  })
})
