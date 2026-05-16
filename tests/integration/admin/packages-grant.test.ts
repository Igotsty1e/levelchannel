import { describe, expect, it } from 'vitest'

import { POST as grantHandler } from '@/app/api/admin/packages/[id]/grant/route'
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
import { buildRequest, extractSessionCookie } from '../helpers'

// PKG-ADMIN-GRANT LBL.1 — operator-grant route tests.
//
// Plan: docs/plans/pkg-admin-grant.md.

async function makeAdmin(emailPrefix: string): Promise<string> {
  const email = `${emailPrefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`
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

async function makeLearner(emailPrefix: string): Promise<{ id: string; email: string }> {
  const email = `${emailPrefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`
  await registerHandler(
    buildRequest('/api/auth/register', {
      body: { email, password: 'StrongPassword123', personalDataConsentAccepted: true },
    }),
  )
  const acc = await getAccountByEmail(email)
  await markAccountVerified(acc!.id)
  return { id: acc!.id, email }
}

describe('POST /api/admin/packages/[id]/grant — operator-driven grant', () => {
  it('happy path: admin grants package → 200 + synthetic order + purchase + audit', async () => {
    const adminCookie = await makeAdmin('grant-admin')
    const learner = await makeLearner('grant-learner')
    const pkg = await createPackage({
      slug: `grant-pkg-${Date.now()}`,
      titleRu: '10 уроков',
      durationMinutes: 60,
      count: 10,
      amountKopecks: 35_000_00,
    })

    const res = await grantHandler(
      buildRequest(`/api/admin/packages/${pkg.id}/grant`, {
        cookie: adminCookie,
        body: { targetAccountId: learner.id, reason: 'компенсация за инцидент' },
        headers: { 'Idempotency-Key': `grant-${Date.now()}` },
      }),
      { params: Promise.resolve({ id: pkg.id }) },
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.invoiceId).toMatch(/^lc_adm_/)
    expect(json.titleSnapshot).toBe('10 уроков')
    expect(json.count).toBe(10)

    // payment_orders synthetic row exists.
    const orderRow = await getDbPool().query(
      `select provider, status, granted_by_operator_id, customer_email, description
         from payment_orders where invoice_id = $1`,
      [json.invoiceId],
    )
    expect(orderRow.rows[0].provider).toBe('admin_grant')
    expect(orderRow.rows[0].status).toBe('granted')
    expect(orderRow.rows[0].customer_email).toBe(learner.email)
    expect(orderRow.rows[0].description).toContain('Admin grant')
    expect(orderRow.rows[0].description).toContain('компенсация')

    // package_purchases row created.
    const purchaseRow = await getDbPool().query(
      `select account_id, count_initial, duration_minutes, title_snapshot
         from package_purchases where id = $1`,
      [json.purchaseId],
    )
    expect(purchaseRow.rows[0].account_id).toBe(learner.id)
    expect(Number(purchaseRow.rows[0].count_initial)).toBe(10)
    expect(Number(purchaseRow.rows[0].duration_minutes)).toBe(60)

    // payment_allocations row created.
    const allocRow = await getDbPool().query(
      `select kind, target_id from payment_allocations where payment_order_id = $1`,
      [json.invoiceId],
    )
    expect(allocRow.rows[0].kind).toBe('package')
    expect(allocRow.rows[0].target_id).toBe(json.purchaseId)
  })

  it('anonymous → 401', async () => {
    const pkg = await createPackage({
      slug: `grant-anon-${Date.now()}`,
      titleRu: 'Anon',
      durationMinutes: 60,
      count: 5,
      amountKopecks: 100_00,
    })
    const res = await grantHandler(
      buildRequest(`/api/admin/packages/${pkg.id}/grant`, {
        body: { targetAccountId: '00000000-0000-0000-0000-000000000001', reason: 'x' },
      }),
      { params: Promise.resolve({ id: pkg.id }) },
    )
    expect(res.status).toBe(401)
  })

  it('learner role → 403', async () => {
    const learner = await makeLearner('grant-learner-role')
    const login = await loginHandler(
      buildRequest('/api/auth/login', {
        body: { email: learner.email, password: 'StrongPassword123' },
      }),
    )
    const learnerCookie = extractSessionCookie(login.headers.get('Set-Cookie'))!
    const pkg = await createPackage({
      slug: `grant-learner-role-${Date.now()}`,
      titleRu: 'Learner role',
      durationMinutes: 60,
      count: 5,
      amountKopecks: 100_00,
    })
    const res = await grantHandler(
      buildRequest(`/api/admin/packages/${pkg.id}/grant`, {
        cookie: learnerCookie,
        body: { targetAccountId: learner.id, reason: 'x' },
      }),
      { params: Promise.resolve({ id: pkg.id }) },
    )
    expect([401, 403]).toContain(res.status)
  })

  it('invalid target account id → 400', async () => {
    const adminCookie = await makeAdmin('grant-invalid-target')
    const pkg = await createPackage({
      slug: `grant-bad-target-${Date.now()}`,
      titleRu: 'Bad',
      durationMinutes: 60,
      count: 5,
      amountKopecks: 100_00,
    })
    const res = await grantHandler(
      buildRequest(`/api/admin/packages/${pkg.id}/grant`, {
        cookie: adminCookie,
        body: { targetAccountId: 'not-a-uuid', reason: 'x' },
      }),
      { params: Promise.resolve({ id: pkg.id }) },
    )
    expect(res.status).toBe(400)
  })

  it('missing reason → 400', async () => {
    const adminCookie = await makeAdmin('grant-no-reason')
    const learner = await makeLearner('grant-no-reason-target')
    const pkg = await createPackage({
      slug: `grant-no-reason-${Date.now()}`,
      titleRu: 'No reason',
      durationMinutes: 60,
      count: 5,
      amountKopecks: 100_00,
    })
    const res = await grantHandler(
      buildRequest(`/api/admin/packages/${pkg.id}/grant`, {
        cookie: adminCookie,
        body: { targetAccountId: learner.id, reason: '' },
      }),
      { params: Promise.resolve({ id: pkg.id }) },
    )
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('reason_required')
  })

  it('target is admin → 422 target_account_unavailable', async () => {
    const adminCookie = await makeAdmin('grant-target-admin')
    const targetAdmin = await makeLearner('grant-target-as-admin')
    await grantAccountRole(targetAdmin.id, 'admin', null)
    const pkg = await createPackage({
      slug: `grant-admin-target-${Date.now()}`,
      titleRu: 'Admin target',
      durationMinutes: 60,
      count: 5,
      amountKopecks: 100_00,
    })
    const res = await grantHandler(
      buildRequest(`/api/admin/packages/${pkg.id}/grant`, {
        cookie: adminCookie,
        body: { targetAccountId: targetAdmin.id, reason: 'should reject' },
      }),
      { params: Promise.resolve({ id: pkg.id }) },
    )
    expect(res.status).toBe(422)
    const json = await res.json()
    expect(json.error).toBe('target_account_unavailable')
  })

  it('inactive package → 422 package_inactive', async () => {
    const adminCookie = await makeAdmin('grant-inactive')
    const learner = await makeLearner('grant-inactive-target')
    const pkg = await createPackage({
      slug: `grant-inactive-${Date.now()}`,
      titleRu: 'Inactive',
      durationMinutes: 60,
      count: 5,
      amountKopecks: 100_00,
    })
    await getDbPool().query(
      `update lesson_packages set is_active = false where id = $1`,
      [pkg.id],
    )
    const res = await grantHandler(
      buildRequest(`/api/admin/packages/${pkg.id}/grant`, {
        cookie: adminCookie,
        body: { targetAccountId: learner.id, reason: 'x' },
      }),
      { params: Promise.resolve({ id: pkg.id }) },
    )
    expect(res.status).toBe(422)
    const json = await res.json()
    expect(json.error).toBe('package_inactive')
  })

  it('anti-stacking gate: second grant of same-duration package → 409', async () => {
    const adminCookie = await makeAdmin('grant-stacking')
    const learner = await makeLearner('grant-stacking-target')
    const pkgA = await createPackage({
      slug: `grant-stackA-${Date.now()}`,
      titleRu: 'Stack A',
      durationMinutes: 60,
      count: 5,
      amountKopecks: 100_00,
    })
    const pkgB = await createPackage({
      slug: `grant-stackB-${Date.now()}`,
      titleRu: 'Stack B',
      durationMinutes: 60,
      count: 3,
      amountKopecks: 50_00,
    })
    const res1 = await grantHandler(
      buildRequest(`/api/admin/packages/${pkgA.id}/grant`, {
        cookie: adminCookie,
        body: { targetAccountId: learner.id, reason: 'first' },
        headers: { 'Idempotency-Key': `stack1-${Date.now()}` },
      }),
      { params: Promise.resolve({ id: pkgA.id }) },
    )
    expect(res1.status).toBe(200)

    const res2 = await grantHandler(
      buildRequest(`/api/admin/packages/${pkgB.id}/grant`, {
        cookie: adminCookie,
        body: { targetAccountId: learner.id, reason: 'second same duration' },
        headers: { 'Idempotency-Key': `stack2-${Date.now()}` },
      }),
      { params: Promise.resolve({ id: pkgB.id }) },
    )
    expect(res2.status).toBe(409)
    const json = await res2.json()
    expect(json.error).toBe('already_owns_active_package')
  })

  it('allowStacking=true bypasses anti-stacking gate', async () => {
    const adminCookie = await makeAdmin('grant-allow-stacking')
    const learner = await makeLearner('grant-allow-target')
    const pkg = await createPackage({
      slug: `grant-allow-${Date.now()}`,
      titleRu: 'Allow stack',
      durationMinutes: 60,
      count: 5,
      amountKopecks: 100_00,
    })
    const res1 = await grantHandler(
      buildRequest(`/api/admin/packages/${pkg.id}/grant`, {
        cookie: adminCookie,
        body: { targetAccountId: learner.id, reason: 'first' },
        headers: { 'Idempotency-Key': `allow1-${Date.now()}` },
      }),
      { params: Promise.resolve({ id: pkg.id }) },
    )
    expect(res1.status).toBe(200)
    const json1 = await res1.json()

    const res2 = await grantHandler(
      buildRequest(`/api/admin/packages/${pkg.id}/grant`, {
        cookie: adminCookie,
        body: { targetAccountId: learner.id, reason: 'second stacked', allowStacking: true },
        headers: { 'Idempotency-Key': `allow2-${Date.now()}` },
      }),
      { params: Promise.resolve({ id: pkg.id }) },
    )
    expect(res2.status).toBe(200)
    const json2 = await res2.json()
    expect(json2.invoiceId).not.toBe(json1.invoiceId)
    expect(json2.purchaseId).not.toBe(json1.purchaseId)
  })

  it('reason persists in payment_orders.description (durable, not best-effort audit only)', async () => {
    const adminCookie = await makeAdmin('grant-reason-durable')
    const learner = await makeLearner('grant-reason-target')
    const pkg = await createPackage({
      slug: `grant-reason-${Date.now()}`,
      titleRu: 'Reason durability',
      durationMinutes: 60,
      count: 5,
      amountKopecks: 100_00,
    })
    const myReason = 'специфическая причина выдачи для теста ' + Date.now()
    const res = await grantHandler(
      buildRequest(`/api/admin/packages/${pkg.id}/grant`, {
        cookie: adminCookie,
        body: { targetAccountId: learner.id, reason: myReason },
        headers: { 'Idempotency-Key': `reason-${Date.now()}` },
      }),
      { params: Promise.resolve({ id: pkg.id }) },
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    const row = await getDbPool().query(
      `select description from payment_orders where invoice_id = $1`,
      [json.invoiceId],
    )
    expect(row.rows[0].description).toContain(myReason)
  })
})
