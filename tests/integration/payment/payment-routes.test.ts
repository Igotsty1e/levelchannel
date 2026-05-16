import { afterAll, describe, expect, it } from 'vitest'

import { POST as cancelHandler } from '@/app/api/payments/[invoiceId]/cancel/route'
import { GET as paymentStatusHandler } from '@/app/api/payments/[invoiceId]/route'
import { POST as mockConfirmHandler } from '@/app/api/payments/mock/[invoiceId]/confirm/route'
import { POST as createHandler } from '@/app/api/payments/route'
import { POST as loginHandler } from '@/app/api/auth/login/route'
import { POST as registerHandler } from '@/app/api/auth/register/route'
import {
  getAccountByEmail,
  grantAccountRole,
  markAccountVerified,
} from '@/lib/auth/accounts'
import { listPaymentAuditEventsByInvoice } from '@/lib/audit/payment-events'
import { getDbPool } from '@/lib/db/pool'

import { buildRequest, extractSessionCookie } from '../helpers'
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

    // PKG-LEARNER-BUY epic-end paranoia round 2 WARN #1 — pin the
    // CloudPayments server-side success-redirect contract for the
    // tariff/free-amount checkout path too (mirrors the package-buy
    // regression in checkout-package.test.ts). Without `&token=` on
    // successRedirectUrl, /thank-you's polling 401s on
    // /api/payments/[invoiceId]. The assertion only applies when
    // provider=cloudpayments (mock provider returns checkoutIntent=null
    // — no widget, no redirect).
    expect(typeof body.receiptToken).toBe('string')
    if (body.checkoutIntent !== null) {
      expect(body.checkoutIntent?.successRedirectUrl).toContain('/thank-you')
      expect(body.checkoutIntent?.successRedirectUrl).toContain(
        `invoiceId=${encodeURIComponent(invoiceId)}`,
      )
      expect(body.checkoutIntent?.successRedirectUrl).toContain(
        `&token=${encodeURIComponent(body.receiptToken)}`,
      )
    }

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
    // Create. Wave 6.1 Phase 2 — capture the receipt token from the
    // create-order response and thread it into cancel via header.
    const res = await createHandler(
      buildCreateRequest({
        amountRub: 2000,
        customerEmail: 'cancel@example.com',
        personalDataConsentAccepted: true,
      }),
    )
    const { order, receiptToken } = await res.json()
    const invoiceId = order.invoiceId as string

    // Cancel.
    const cancelRes = await cancelHandler(
      buildRequest(`/api/payments/${invoiceId}/cancel`, {
        body: {},
        headers: { 'X-Receipt-Token': receiptToken },
      }),
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

  // Wave 21 — receipt-token gate negative cases (Codex Wave 13 Pass 3 #7).
  // Wave 6.1 #4 Phase 2 introduced the receipt-token capability gate so
  // that a known invoiceId alone can't flip a pending order to cancelled.
  // The happy-path test above proves the gate accepts the right token;
  // these three pin the rejections.

  async function createPendingForToken(tag: string) {
    const res = await createHandler(
      buildCreateRequest({
        amountRub: 1500,
        customerEmail: `cancel-${tag}@example.com`,
        personalDataConsentAccepted: true,
      }),
    )
    const json = await res.json()
    return {
      invoiceId: json.order.invoiceId as string,
      receiptToken: json.receiptToken as string,
    }
  }

  it('refuses 401 on missing token', async () => {
    const { invoiceId } = await createPendingForToken('no-token')
    const res = await cancelHandler(
      buildRequest(`/api/payments/${invoiceId}/cancel`, { body: {} }),
      { params: Promise.resolve({ invoiceId }) },
    )
    expect(res.status).toBe(401)
    // Order must still be pending — the missing token must not have
    // succeeded in the cancel side effect.
    const row = await readOrderRow(invoiceId)
    expect(row.status).toBe('pending')
  })

  it('refuses 401 on wrong token', async () => {
    const { invoiceId } = await createPendingForToken('bad-token')
    const res = await cancelHandler(
      buildRequest(`/api/payments/${invoiceId}/cancel`, {
        body: {},
        headers: { 'X-Receipt-Token': 'definitely-not-the-real-token' },
      }),
      { params: Promise.resolve({ invoiceId }) },
    )
    expect(res.status).toBe(401)
    const row = await readOrderRow(invoiceId)
    expect(row.status).toBe('pending')
  })

  it('refuses 401 when the token belongs to a DIFFERENT invoice', async () => {
    const a = await createPendingForToken('cross-a')
    const b = await createPendingForToken('cross-b')
    const res = await cancelHandler(
      buildRequest(`/api/payments/${a.invoiceId}/cancel`, {
        body: {},
        // B's token against A's invoice — must reject.
        headers: { 'X-Receipt-Token': b.receiptToken },
      }),
      { params: Promise.resolve({ invoiceId: a.invoiceId }) },
    )
    expect(res.status).toBe(401)
    // Codex Wave 21 review feedback. Just checking A.status === pending
    // misses the case where the gate rejects with 401 yet still mutates
    // B (whose token was used) or writes an order.cancelled audit.
    // Pin all four: both rows still pending, no cancelled audit on
    // either invoice.
    expect((await readOrderRow(a.invoiceId)).status).toBe('pending')
    expect((await readOrderRow(b.invoiceId)).status).toBe('pending')
    const aEvents = await listPaymentAuditEventsByInvoice(a.invoiceId)
    const bEvents = await listPaymentAuditEventsByInvoice(b.invoiceId)
    expect(aEvents.some((e) => e.eventType === 'order.cancelled')).toBe(false)
    expect(bEvents.some((e) => e.eventType === 'order.cancelled')).toBe(false)
  })
})

// RECEIPT-3DS-TOKEN (2026-05-16) — session-fallback for the
// receipt-token gate. The saved-card 3DS server-side redirect to
// /thank-you cannot carry the plain token; an authenticated learner
// session matching order.metadata.accountId is accepted as proof.

async function registerAndLogin(emailPrefix: string): Promise<{
  cookie: string
  accountId: string
  email: string
}> {
  const email = `${emailPrefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`
  await registerHandler(
    buildRequest('/api/auth/register', {
      body: { email, password: 'StrongPassword123', personalDataConsentAccepted: true },
    }),
  )
  const acc = await getAccountByEmail(email)
  await markAccountVerified(acc!.id)
  const login = await loginHandler(
    buildRequest('/api/auth/login', { body: { email, password: 'StrongPassword123' } }),
  )
  return {
    cookie: extractSessionCookie(login.headers.get('Set-Cookie'))!,
    accountId: acc!.id,
    email,
  }
}

async function seedPaidNotGrantedOrderForAccount(opts: {
  accountId: string
  email: string
}): Promise<string> {
  const invoiceId = `lc_recpt_${Date.now()}${Math.floor(Math.random() * 1e6)}`
  // Receipt-token gate needs receipt_token_hash != null (post-Phase-3),
  // so seed with a placeholder hash. Tests don't present a real
  // matching token — they want the session fallback to take over.
  const placeholderHash = 'a'.repeat(64)
  await getDbPool().query(
    `insert into payment_orders (
       invoice_id, amount_rub, currency, description, provider, status,
       created_at, updated_at, customer_email, receipt_email, receipt,
       metadata, receipt_token_hash
     ) values (
       $1, 1500, 'RUB', 'session fallback seed', 'cloudpayments', 'pending',
       now(), now(), $2, $2, '{}'::jsonb,
       $3::jsonb, $4
     )`,
    [
      invoiceId,
      opts.email,
      JSON.stringify({ source: 'one_click', accountId: opts.accountId }),
      placeholderHash,
    ],
  )
  return invoiceId
}

describe('receipt-token-gate session fallback', () => {
  it('GET /api/payments/[id] with matching learner session (no token) → 200', async () => {
    const learner = await registerAndLogin('rcpt-learner-200')
    const invoiceId = await seedPaidNotGrantedOrderForAccount({
      accountId: learner.accountId,
      email: learner.email,
    })
    const res = await paymentStatusHandler(
      buildRequest(`/api/payments/${invoiceId}`, {
        method: 'GET',
        cookie: learner.cookie,
      }),
      { params: Promise.resolve({ invoiceId }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.order?.invoiceId).toBe(invoiceId)
  })

  it('GET with matching UNVERIFIED learner session → 200 (verify NOT required)', async () => {
    // Anti-spoof predicate is intentionally lighter than
    // isLearnerArchetypeCandidate; this test pins the choice.
    const email = `rcpt-unverif-${Date.now()}@example.com`
    await registerHandler(
      buildRequest('/api/auth/register', {
        body: { email, password: 'StrongPassword123', personalDataConsentAccepted: true },
      }),
    )
    const acc = await getAccountByEmail(email)
    // NOTE: NOT calling markAccountVerified here.
    const login = await loginHandler(
      buildRequest('/api/auth/login', { body: { email, password: 'StrongPassword123' } }),
    )
    const cookie = extractSessionCookie(login.headers.get('Set-Cookie'))!
    const invoiceId = await seedPaidNotGrantedOrderForAccount({
      accountId: acc!.id,
      email,
    })
    const res = await paymentStatusHandler(
      buildRequest(`/api/payments/${invoiceId}`, {
        method: 'GET',
        cookie,
      }),
      { params: Promise.resolve({ invoiceId }) },
    )
    expect(res.status).toBe(200)
  })

  it('GET with admin session matching metadata → 401 (admin must NOT use session fallback)', async () => {
    const admin = await registerAndLogin('rcpt-admin-401')
    await grantAccountRole(admin.accountId, 'admin', null)
    const invoiceId = await seedPaidNotGrantedOrderForAccount({
      accountId: admin.accountId,
      email: admin.email,
    })
    const res = await paymentStatusHandler(
      buildRequest(`/api/payments/${invoiceId}`, {
        method: 'GET',
        cookie: admin.cookie,
      }),
      { params: Promise.resolve({ invoiceId }) },
    )
    expect(res.status).toBe(401)
  })

  it('GET with teacher session matching metadata → 401', async () => {
    const teacher = await registerAndLogin('rcpt-teacher-401')
    await grantAccountRole(teacher.accountId, 'teacher', null)
    const invoiceId = await seedPaidNotGrantedOrderForAccount({
      accountId: teacher.accountId,
      email: teacher.email,
    })
    const res = await paymentStatusHandler(
      buildRequest(`/api/payments/${invoiceId}`, {
        method: 'GET',
        cookie: teacher.cookie,
      }),
      { params: Promise.resolve({ invoiceId }) },
    )
    expect(res.status).toBe(401)
  })

  it('GET with learner session whose accountId does NOT match metadata → 401', async () => {
    const learner = await registerAndLogin('rcpt-learner-mismatch')
    const other = await registerAndLogin('rcpt-other')
    const invoiceId = await seedPaidNotGrantedOrderForAccount({
      accountId: other.accountId,
      email: other.email,
    })
    const res = await paymentStatusHandler(
      buildRequest(`/api/payments/${invoiceId}`, {
        method: 'GET',
        cookie: learner.cookie,
      }),
      { params: Promise.resolve({ invoiceId }) },
    )
    expect(res.status).toBe(401)
  })

  it('POST cancel with matching learner session → 200 + audit gate=session_match', async () => {
    const learner = await registerAndLogin('rcpt-cancel-200')
    const invoiceId = await seedPaidNotGrantedOrderForAccount({
      accountId: learner.accountId,
      email: learner.email,
    })
    const res = await cancelHandler(
      buildRequest(`/api/payments/${invoiceId}/cancel`, {
        body: {},
        cookie: learner.cookie,
      }),
      { params: Promise.resolve({ invoiceId }) },
    )
    expect(res.status).toBe(200)
    const events = await listPaymentAuditEventsByInvoice(invoiceId)
    const cancel = events.find((e) => e.eventType === 'order.cancelled')
    expect(cancel).toBeTruthy()
    const payload = cancel!.payload as { gate?: string } | null
    expect(payload?.gate).toBe('session_match')
  })

  it('POST cancel with admin session matching metadata → 401', async () => {
    const admin = await registerAndLogin('rcpt-cancel-admin')
    await grantAccountRole(admin.accountId, 'admin', null)
    const invoiceId = await seedPaidNotGrantedOrderForAccount({
      accountId: admin.accountId,
      email: admin.email,
    })
    const res = await cancelHandler(
      buildRequest(`/api/payments/${invoiceId}/cancel`, {
        body: {},
        cookie: admin.cookie,
      }),
      { params: Promise.resolve({ invoiceId }) },
    )
    expect(res.status).toBe(401)
  })

  it('POST cancel with teacher session matching metadata → 401', async () => {
    const teacher = await registerAndLogin('rcpt-cancel-teacher')
    await grantAccountRole(teacher.accountId, 'teacher', null)
    const invoiceId = await seedPaidNotGrantedOrderForAccount({
      accountId: teacher.accountId,
      email: teacher.email,
    })
    const res = await cancelHandler(
      buildRequest(`/api/payments/${invoiceId}/cancel`, {
        body: {},
        cookie: teacher.cookie,
      }),
      { params: Promise.resolve({ invoiceId }) },
    )
    expect(res.status).toBe(401)
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
