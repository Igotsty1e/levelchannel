import { describe, expect, it } from 'vitest'

import { POST as retryGrantHandler } from '@/app/api/admin/reconciliation/package-grants/[invoiceId]/retry-grant/route'
import { POST as loginHandler } from '@/app/api/auth/login/route'
import { POST as registerHandler } from '@/app/api/auth/register/route'
import {
  getAccountByEmail,
  grantAccountRole,
  markAccountVerified,
} from '@/lib/auth/accounts'
import { createPackage } from '@/lib/billing/packages'
import { getDbPool } from '@/lib/db/pool'

import '../setup'
import { buildRequest, extractSessionCookie, freshInvoiceId } from '../helpers'

// PKG-RECON RECON.2 — operator retry-grant action.
//
// Scenarios:
//   1. Happy path: paid order + active package → retry succeeds,
//      package_purchases + package_grant_resolutions rows created.
//   2. Inactive package: returns reason; no resolution row.
//   3. Race protection: invoice already resolved → 409.
//   4. Auth: learner gets 401/403.

async function makeAdmin(emailPrefix: string): Promise<string> {
  const email = `${emailPrefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`
  await registerHandler(
    buildRequest('/api/auth/register', {
      body: { email, password: 'StrongPassword123', personalDataConsentAccepted: true },
    }),
  )
  const created = await getAccountByEmail(email)
  await markAccountVerified(created!.id)
  await grantAccountRole(created!.id, 'admin', null)
  const login = await loginHandler(
    buildRequest('/api/auth/login', { body: { email, password: 'StrongPassword123' } }),
  )
  return extractSessionCookie(login.headers.get('Set-Cookie'))!
}

async function makeLearner(emailPrefix: string): Promise<{ id: string; email: string }> {
  const email = `${emailPrefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`
  await registerHandler(
    buildRequest('/api/auth/register', {
      body: { email, password: 'StrongPassword123', personalDataConsentAccepted: true },
    }),
  )
  const created = await getAccountByEmail(email)
  await markAccountVerified(created!.id)
  return { id: created!.id, email }
}

async function insertPaidNotGrantedOrder(opts: {
  accountId: string
  email: string
  packageSlug: string
  amountRub: number
}): Promise<string> {
  const pool = getDbPool()
  const invoiceId = freshInvoiceId('lc_retry')
  await pool.query(
    `insert into payment_orders
       (invoice_id, amount_rub, currency, status, provider, description,
        customer_email, receipt, receipt_email, metadata, paid_at,
        created_at, updated_at)
     values
       ($1, $2, 'RUB', 'paid', 'mock', 'retry test',
        $3, '{}'::jsonb, $3, $4::jsonb, now(),
        now(), now())`,
    [
      invoiceId,
      opts.amountRub,
      opts.email,
      JSON.stringify({
        accountId: opts.accountId,
        packageSlug: opts.packageSlug,
        packageDurationMinutes: 60,
      }),
    ],
  )
  return invoiceId
}

describe('POST /api/admin/reconciliation/.../retry-grant', () => {
  it('happy path: active package + good metadata → grant succeeds + resolution row', async () => {
    const adminCookie = await makeAdmin('retry-admin')
    const learner = await makeLearner('retry-learner')
    const pkg = await createPackage({
      slug: `retry-pkg-${Date.now()}`,
      titleRu: '10 уроков',
      durationMinutes: 60,
      count: 10,
      amountKopecks: 35_000_00,
    })
    const invoice = await insertPaidNotGrantedOrder({
      accountId: learner.id,
      email: learner.email,
      packageSlug: pkg.slug,
      amountRub: 35_000,
    })

    const res = await retryGrantHandler(
      buildRequest(
        `/api/admin/reconciliation/package-grants/${invoice}/retry-grant`,
        {
          cookie: adminCookie,
          body: { reason: 'Manually retrying after operator triage' },
          headers: { 'Idempotency-Key': `retry-key-${Date.now()}` },
        },
      ),
      { params: Promise.resolve({ invoiceId: invoice }) },
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)

    // Resolution row exists.
    const resolutionRow = await getDbPool().query(
      `select resolution, reason from package_grant_resolutions where invoice_id = $1`,
      [invoice],
    )
    expect(resolutionRow.rows).toHaveLength(1)
    expect(resolutionRow.rows[0].resolution).toBe('granted')

    // Package purchase row exists.
    const purchaseRow = await getDbPool().query(
      `select account_id from package_purchases where payment_order_id = $1`,
      [invoice],
    )
    expect(purchaseRow.rows).toHaveLength(1)
    expect(purchaseRow.rows[0].account_id).toBe(learner.id)
  })

  it('already-resolved invoice → 409 not_paid_not_granted', async () => {
    const adminCookie = await makeAdmin('retry-resolved')
    const learner = await makeLearner('retry-resolved-learner')
    const pkg = await createPackage({
      slug: `retry-resolved-pkg-${Date.now()}`,
      titleRu: '5 уроков',
      durationMinutes: 60,
      count: 5,
      amountKopecks: 17_500_00,
    })
    const invoice = await insertPaidNotGrantedOrder({
      accountId: learner.id,
      email: learner.email,
      packageSlug: pkg.slug,
      amountRub: 17_500,
    })
    // Mark resolved manually first.
    await getDbPool().query(
      `insert into package_grant_resolutions
         (invoice_id, resolved_by_account_id, resolution, reason)
       values ($1, $2, 'marked_resolved_manually', 'Pre-resolved for test')`,
      [invoice, learner.id],
    )

    const res = await retryGrantHandler(
      buildRequest(
        `/api/admin/reconciliation/package-grants/${invoice}/retry-grant`,
        {
          cookie: adminCookie,
          body: { reason: 'Should refuse' },
          headers: { 'Idempotency-Key': `retry-resolved-${Date.now()}` },
        },
      ),
      { params: Promise.resolve({ invoiceId: invoice }) },
    )
    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.error).toBe('not_paid_not_granted')
  })

  it('learner role → 401/403', async () => {
    const learner = await makeLearner('retry-learner-403')
    const loginRes = await loginHandler(
      buildRequest('/api/auth/login', {
        body: { email: learner.email, password: 'StrongPassword123' },
      }),
    )
    const learnerCookie = extractSessionCookie(loginRes.headers.get('Set-Cookie'))!
    const res = await retryGrantHandler(
      buildRequest(
        `/api/admin/reconciliation/package-grants/lc_test/retry-grant`,
        {
          cookie: learnerCookie,
          body: { reason: 'Should not be allowed' },
          headers: { 'Idempotency-Key': `retry-403-${Date.now()}` },
        },
      ),
      { params: Promise.resolve({ invoiceId: 'lc_test' }) },
    )
    expect([401, 403]).toContain(res.status)
  })
})
