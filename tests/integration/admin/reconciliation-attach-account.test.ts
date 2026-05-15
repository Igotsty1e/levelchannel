import { describe, expect, it } from 'vitest'

import { POST as attachAccountHandler } from '@/app/api/admin/reconciliation/package-grants/[invoiceId]/attach-account/route'
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

// PKG-RECON RECON.3 — operator attach-account action.

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

async function makeLearner(prefix: string): Promise<{ id: string; email: string }> {
  const email = `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`
  await registerHandler(
    buildRequest('/api/auth/register', {
      body: { email, password: 'StrongPassword123', personalDataConsentAccepted: true },
    }),
  )
  const acc = await getAccountByEmail(email)
  await markAccountVerified(acc!.id)
  return { id: acc!.id, email }
}

async function insertPaidNotGrantedOrderWithBadAccount(opts: {
  email: string
  packageSlug: string
}): Promise<string> {
  const pool = getDbPool()
  const invoiceId = freshInvoiceId('lc_attach')
  // metadata.accountId = bogus UUID (typo / wrong-account on widget).
  await pool.query(
    `insert into payment_orders
       (invoice_id, amount_rub, currency, status, provider, description,
        customer_email, receipt, receipt_email, metadata, paid_at,
        created_at, updated_at)
     values
       ($1, 3500, 'RUB', 'paid', 'mock', 'attach test',
        $2, '{}'::jsonb, $2, $3::jsonb, now(),
        now(), now())`,
    [
      invoiceId,
      opts.email,
      JSON.stringify({
        accountId: '00000000-0000-4000-8000-000000000000',
        packageSlug: opts.packageSlug,
        packageDurationMinutes: 60,
      }),
    ],
  )
  return invoiceId
}

describe('POST /api/admin/reconciliation/.../attach-account', () => {
  it('happy path: attach to a valid learner candidate → grant succeeds + resolution row', async () => {
    const adminCookie = await makeAdmin('attach-admin')
    const learner = await makeLearner('attach-target')
    const pkg = await createPackage({
      slug: `attach-pkg-${Date.now()}`,
      titleRu: '10 уроков',
      durationMinutes: 60,
      count: 10,
      amountKopecks: 35_000_00,
    })
    const invoice = await insertPaidNotGrantedOrderWithBadAccount({
      email: 'wrong-email@example.com',
      packageSlug: pkg.slug,
    })

    const res = await attachAccountHandler(
      buildRequest(
        `/api/admin/reconciliation/package-grants/${invoice}/attach-account`,
        {
          cookie: adminCookie,
          body: { targetAccountId: learner.id, reason: 'Typo on widget; attaching to correct learner' },
          headers: { 'Idempotency-Key': `attach-${Date.now()}` },
        },
      ),
      { params: Promise.resolve({ invoiceId: invoice }) },
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.newAccountId).toBe(learner.id)

    const purchaseRow = await getDbPool().query(
      `select account_id from package_purchases where payment_order_id = $1`,
      [invoice],
    )
    expect(purchaseRow.rows).toHaveLength(1)
    expect(purchaseRow.rows[0].account_id).toBe(learner.id)

    const resolutionRow = await getDbPool().query(
      `select resolution from package_grant_resolutions where invoice_id = $1`,
      [invoice],
    )
    expect(resolutionRow.rows[0].resolution).toBe('attached_and_granted')
  })

  it('refuses to attach to an admin account (target_account_unavailable)', async () => {
    const adminCookie = await makeAdmin('attach-self-admin')
    // The admin's OWN account is not a learner candidate.
    const adminEmail = adminCookie.split('=')[1] // dummy not real but we want their account id
    // Easier: register a separate admin and try to attach to them.
    const otherAdminEmail = `attach-other-admin-${Date.now()}@example.com`
    await registerHandler(
      buildRequest('/api/auth/register', {
        body: { email: otherAdminEmail, password: 'StrongPassword123', personalDataConsentAccepted: true },
      }),
    )
    const otherAdmin = await getAccountByEmail(otherAdminEmail)
    await markAccountVerified(otherAdmin!.id)
    await grantAccountRole(otherAdmin!.id, 'admin', null)

    const pkg = await createPackage({
      slug: `attach-admin-pkg-${Date.now()}`,
      titleRu: '5 уроков',
      durationMinutes: 60,
      count: 5,
      amountKopecks: 17_500_00,
    })
    const invoice = await insertPaidNotGrantedOrderWithBadAccount({
      email: 'attached-admin@example.com',
      packageSlug: pkg.slug,
    })

    const res = await attachAccountHandler(
      buildRequest(
        `/api/admin/reconciliation/package-grants/${invoice}/attach-account`,
        {
          cookie: adminCookie,
          body: { targetAccountId: otherAdmin!.id, reason: 'Should fail' },
          headers: { 'Idempotency-Key': `attach-refuse-admin-${Date.now()}` },
        },
      ),
      { params: Promise.resolve({ invoiceId: invoice }) },
    )
    expect(res.status).toBe(422)
    const json = await res.json()
    expect(json.error).toBe('target_account_unavailable')
    void adminEmail
  })

  it('refuses on missing/invalid targetAccountId (400)', async () => {
    const adminCookie = await makeAdmin('attach-bad')
    const res = await attachAccountHandler(
      buildRequest(
        `/api/admin/reconciliation/package-grants/lc_x/attach-account`,
        {
          cookie: adminCookie,
          body: { targetAccountId: 'not-a-uuid' },
          headers: { 'Idempotency-Key': `attach-bad-${Date.now()}` },
        },
      ),
      { params: Promise.resolve({ invoiceId: 'lc_x' }) },
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_target_account_id')
  })
})
