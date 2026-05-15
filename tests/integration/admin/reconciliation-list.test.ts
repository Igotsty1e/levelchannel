import { describe, expect, it } from 'vitest'

import { GET as reconListHandler } from '@/app/api/admin/reconciliation/package-grants/route'
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

// PKG-RECON RECON.1 — GET /api/admin/reconciliation/package-grants
// surface. Auth + happy-path + auth-failure cases. Drift detector for
// the shared paid_not_granted predicate lives elsewhere
// (tests/integration/billing/paid-not-granted.test.ts).

async function makeAdmin(emailPrefix: string): Promise<string> {
  const email = `${emailPrefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`
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
  return extractSessionCookie(login.headers.get('Set-Cookie'))!
}

async function makeLearner(emailPrefix: string): Promise<string> {
  const email = `${emailPrefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`
  const password = 'StrongPassword123'
  await registerHandler(
    buildRequest('/api/auth/register', {
      body: { email, password, personalDataConsentAccepted: true },
    }),
  )
  const created = await getAccountByEmail(email)
  await markAccountVerified(created!.id)
  const login = await loginHandler(
    buildRequest('/api/auth/login', { body: { email, password } }),
  )
  return extractSessionCookie(login.headers.get('Set-Cookie'))!
}

async function insertPaidNotGrantedOrder(opts: {
  accountId: string
  email: string
}): Promise<string> {
  const pool = getDbPool()
  const invoiceId = freshInvoiceId('lc_recon')
  await pool.query(
    `insert into payment_orders
       (invoice_id, amount_rub, currency, status, provider, description,
        customer_email, receipt, receipt_email, metadata, paid_at,
        created_at, updated_at)
     values
       ($1, 3500, 'RUB', 'paid', 'mock', 'package test',
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

describe('GET /api/admin/reconciliation/package-grants', () => {
  it('admin sees paid_not_granted orders + total count', async () => {
    const adminCookieValue = await makeAdmin('recon-admin')
    const pool = getDbPool()
    const acc = await pool.query(
      `insert into accounts (email, password_hash, email_verified_at)
       values ($1, 'x', now())
       returning id`,
      [`recon-learner-${Date.now()}@example.com`],
    )
    const learnerId = String(acc.rows[0].id)
    const invoice = await insertPaidNotGrantedOrder({
      accountId: learnerId,
      email: `recon-learner-${Date.now()}@example.com`,
    })

    const res = await reconListHandler(
      buildRequest('/api/admin/reconciliation/package-grants', {
        cookie: adminCookieValue,
      }),
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(Array.isArray(json.orders)).toBe(true)
    expect(typeof json.total).toBe('number')
    expect(json.orders.some((o: { invoiceId: string }) => o.invoiceId === invoice)).toBe(true)
  })

  it('learner gets 401/403 (admin-only)', async () => {
    const learnerCookie = await makeLearner('recon-learner-401')
    const res = await reconListHandler(
      buildRequest('/api/admin/reconciliation/package-grants', {
        cookie: learnerCookie,
      }),
    )
    expect([401, 403]).toContain(res.status)
  })

  it('anonymous gets 401', async () => {
    const res = await reconListHandler(
      buildRequest('/api/admin/reconciliation/package-grants', {}),
    )
    expect([401, 403]).toContain(res.status)
  })

  it('respects ?limit=&offset= pagination caps', async () => {
    const adminCookieValue = await makeAdmin('recon-limit')
    const res = await reconListHandler(
      buildRequest('/api/admin/reconciliation/package-grants', {
        cookie: adminCookieValue,
        searchParams: { limit: '500', offset: '0' },
      }),
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    // limit > 200 clamps to 200
    expect(json.limit).toBe(200)
    expect(json.offset).toBe(0)
  })
})
