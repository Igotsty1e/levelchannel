import { describe, expect, it } from 'vitest'

import { POST as markResolvedHandler } from '@/app/api/admin/reconciliation/package-grants/[invoiceId]/mark-resolved/route'
import { POST as loginHandler } from '@/app/api/auth/login/route'
import { POST as registerHandler } from '@/app/api/auth/register/route'
import {
  getAccountByEmail,
  grantAccountRole,
  markAccountVerified,
} from '@/lib/auth/accounts'
import { checkAccountInFlightPackageGrant } from '@/lib/billing/deletion-guard'
import { getDbPool } from '@/lib/db/pool'

import '../setup'
import { buildRequest, extractSessionCookie, freshInvoiceId } from '../helpers'

// PKG-RECON RECON.4 — operator mark-resolved action.
// Critical invariant: deletion-guard unblocks the learner after
// mark-resolved (round 2 BLOCKER #2 closure).

async function makeAdmin(prefix: string): Promise<string> {
  const email = `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`
  await registerHandler(
    buildRequest('/api/auth/register', {
      body: { email, password: 'StrongPassword123', personalDataConsentAccepted: true },
    }),
  )
  const acc = await getAccountByEmail(email)
  await markAccountVerified(acc!.id)
  await grantAccountRole(acc!.id, 'admin', null)
  const login = await loginHandler(
    buildRequest('/api/auth/login', { body: { email, password: 'StrongPassword123' } }),
  )
  return extractSessionCookie(login.headers.get('Set-Cookie'))!
}

async function makeLearner(prefix: string): Promise<string> {
  const email = `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`
  await registerHandler(
    buildRequest('/api/auth/register', {
      body: { email, password: 'StrongPassword123', personalDataConsentAccepted: true },
    }),
  )
  const acc = await getAccountByEmail(email)
  await markAccountVerified(acc!.id)
  return acc!.id
}

async function insertPaidNotGrantedOrder(opts: {
  accountId: string
  email: string
}): Promise<string> {
  const pool = getDbPool()
  const invoiceId = freshInvoiceId('lc_mark')
  await pool.query(
    `insert into payment_orders
       (invoice_id, amount_rub, currency, status, provider, description,
        customer_email, receipt, receipt_email, metadata, paid_at,
        created_at, updated_at)
     values
       ($1, 3500, 'RUB', 'paid', 'mock', 'mark test',
        $2, '{}'::jsonb, $2, $3::jsonb, now(),
        now(), now())`,
    [
      invoiceId,
      opts.email,
      JSON.stringify({
        accountId: opts.accountId,
        packageSlug: 'lessons-10',
      }),
    ],
  )
  return invoiceId
}

describe('POST /api/admin/reconciliation/.../mark-resolved', () => {
  it('happy path: writes resolution row + audit row + UNBLOCKS deletion-guard', async () => {
    const adminCookie = await makeAdmin('mark-admin')
    const learnerId = await makeLearner('mark-learner')
    const learnerEmail = (await getDbPool().query(
      `select email from accounts where id = $1`,
      [learnerId],
    )).rows[0].email
    const invoice = await insertPaidNotGrantedOrder({
      accountId: learnerId,
      email: String(learnerEmail),
    })

    // Sanity: deletion-guard blocks BEFORE mark-resolved.
    const guardBefore = await checkAccountInFlightPackageGrant(getDbPool(), learnerId)
    expect(guardBefore.inFlight).toBe(true)
    expect(guardBefore.reason).toBe('paid_not_granted')

    const res = await markResolvedHandler(
      buildRequest(
        `/api/admin/reconciliation/package-grants/${invoice}/mark-resolved`,
        {
          cookie: adminCookie,
          body: {
            category: 'refunded_offline',
            reason: 'Refunded via CP dashboard manually, tx 99999',
            cpRefundTransactionId: '99999',
          },
          headers: { 'Idempotency-Key': `mark-${Date.now()}` },
        },
      ),
      { params: Promise.resolve({ invoiceId: invoice }) },
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.cpRefundTransactionId).toBe('99999')

    // Resolution row exists.
    const resolutionRow = await getDbPool().query(
      `select resolution, category, reason, payload from package_grant_resolutions where invoice_id = $1`,
      [invoice],
    )
    expect(resolutionRow.rows[0].resolution).toBe('marked_resolved_manually')
    expect(resolutionRow.rows[0].category).toBe('refunded_offline')
    expect(resolutionRow.rows[0].payload.cpRefundTransactionId).toBe('99999')

    // Critical: deletion-guard NOW unblocks.
    const guardAfter = await checkAccountInFlightPackageGrant(getDbPool(), learnerId)
    expect(guardAfter.reason).not.toBe('paid_not_granted')
  })

  it('invalid category → 400', async () => {
    const adminCookie = await makeAdmin('mark-bad-cat')
    const res = await markResolvedHandler(
      buildRequest(
        `/api/admin/reconciliation/package-grants/lc_x/mark-resolved`,
        {
          cookie: adminCookie,
          body: { category: 'wrong', reason: 'x' },
          headers: { 'Idempotency-Key': `mark-bad-${Date.now()}` },
        },
      ),
      { params: Promise.resolve({ invoiceId: 'lc_x' }) },
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_category')
  })

  it('empty reason → 400', async () => {
    const adminCookie = await makeAdmin('mark-empty-reason')
    const res = await markResolvedHandler(
      buildRequest(
        `/api/admin/reconciliation/package-grants/lc_x/mark-resolved`,
        {
          cookie: adminCookie,
          body: { category: 'comped', reason: '' },
          headers: { 'Idempotency-Key': `mark-empty-${Date.now()}` },
        },
      ),
      { params: Promise.resolve({ invoiceId: 'lc_x' }) },
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_reason')
  })
})
