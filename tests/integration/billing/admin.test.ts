import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { POST as postpaidHandler } from '@/app/api/admin/accounts/[id]/postpaid/route'
import {
  GET as listPackagesHandler,
  POST as createPackageHandler,
} from '@/app/api/admin/packages/route'
import { POST as loginHandler } from '@/app/api/auth/login/route'
import { POST as registerHandler } from '@/app/api/auth/register/route'
import {
  getAccountByEmail,
  grantAccountRole,
  markAccountVerified,
} from '@/lib/auth/accounts'
import { getDbPool } from '@/lib/db/pool'

import '../setup'
import { buildRequest, extractSessionCookie } from '../helpers'

beforeAll(() => {
  process.env.BILLING_WAVE_ACTIVE = 'true'
})

afterAll(() => {
  delete process.env.BILLING_WAVE_ACTIVE
})

async function regAdmin() {
  const email = `pr4-admin-${Date.now()}@example.com`
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

async function regLearner() {
  const email = `pr4-learner-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.com`
  const password = 'StrongPassword123'
  await registerHandler(
    buildRequest('/api/auth/register', {
      body: { email, password, personalDataConsentAccepted: true },
    }),
  )
  const created = await getAccountByEmail(email)
  await markAccountVerified(created!.id)
  return { accountId: created!.id }
}

describe('POST /api/admin/accounts/[id]/postpaid', () => {
  it('admin can flip postpaid_allowed true → false → true', async () => {
    const admin = await regAdmin()
    const learner = await regLearner()

    let r = await postpaidHandler(
      buildRequest(`/api/admin/accounts/${learner.accountId}/postpaid`, {
        cookie: admin.cookie,
        body: { allowed: true },
      }),
      { params: Promise.resolve({ id: learner.accountId }) },
    )
    expect(r.status).toBe(200)
    expect((await r.json()).postpaidAllowed).toBe(true)

    r = await postpaidHandler(
      buildRequest(`/api/admin/accounts/${learner.accountId}/postpaid`, {
        cookie: admin.cookie,
        body: { allowed: false },
      }),
      { params: Promise.resolve({ id: learner.accountId }) },
    )
    expect(r.status).toBe(200)
    expect((await r.json()).postpaidAllowed).toBe(false)
  })

  it('non-admin → 403', async () => {
    const learner = await regLearner()
    const otherEmail = `pr4-other-${Date.now()}@example.com`
    await registerHandler(
      buildRequest('/api/auth/register', {
        body: {
          email: otherEmail,
          password: 'StrongPassword123',
          personalDataConsentAccepted: true,
        },
      }),
    )
    const otherLogin = await loginHandler(
      buildRequest('/api/auth/login', {
        body: { email: otherEmail, password: 'StrongPassword123' },
      }),
    )
    const cookie = extractSessionCookie(
      otherLogin.headers.get('Set-Cookie'),
    )!
    const r = await postpaidHandler(
      buildRequest(`/api/admin/accounts/${learner.accountId}/postpaid`, {
        cookie,
        body: { allowed: true },
      }),
      { params: Promise.resolve({ id: learner.accountId }) },
    )
    expect([401, 403]).toContain(r.status)
  })

  it('unknown accountId → 404', async () => {
    const admin = await regAdmin()
    const r = await postpaidHandler(
      buildRequest(
        '/api/admin/accounts/00000000-0000-0000-0000-000000000000/postpaid',
        {
          cookie: admin.cookie,
          body: { allowed: true },
        },
      ),
      {
        params: Promise.resolve({
          id: '00000000-0000-0000-0000-000000000000',
        }),
      },
    )
    expect(r.status).toBe(404)
  })
})

describe('POST /api/admin/packages — create', () => {
  it('admin creates a package; GET returns it', async () => {
    const admin = await regAdmin()
    const r = await createPackageHandler(
      buildRequest('/api/admin/packages', {
        cookie: admin.cookie,
        body: {
          slug: 'pr4-pkg-create',
          titleRu: '5×60 мин',
          durationMinutes: 60,
          count: 5,
          amountKopecks: 17500_00,
        },
      }),
    )
    expect(r.status).toBe(201)
    const body = await r.json()
    expect(body.package.slug).toBe('pr4-pkg-create')

    const list = await listPackagesHandler(
      buildRequest('/api/admin/packages', { cookie: admin.cookie }),
    )
    expect(list.status).toBe(200)
    const listBody = await list.json()
    expect(
      listBody.packages.some(
        (p: { slug: string }) => p.slug === 'pr4-pkg-create',
      ),
    ).toBe(true)
  })

  it('duplicate slug → 409 slug_already_exists', async () => {
    const admin = await regAdmin()
    await createPackageHandler(
      buildRequest('/api/admin/packages', {
        cookie: admin.cookie,
        body: {
          slug: 'pr4-pkg-dup',
          titleRu: 'A',
          durationMinutes: 60,
          count: 5,
          amountKopecks: 100_00,
        },
      }),
    )
    const r = await createPackageHandler(
      buildRequest('/api/admin/packages', {
        cookie: admin.cookie,
        body: {
          slug: 'pr4-pkg-dup',
          titleRu: 'B',
          durationMinutes: 90,
          count: 3,
          amountKopecks: 200_00,
        },
      }),
    )
    expect(r.status).toBe(409)
    expect((await r.json()).error).toBe('slug_already_exists')
  })

  it('missing required fields → 400', async () => {
    const admin = await regAdmin()
    const r = await createPackageHandler(
      buildRequest('/api/admin/packages', {
        cookie: admin.cookie,
        body: { slug: 'incomplete' },
      }),
    )
    expect(r.status).toBe(400)
  })
})

describe('lesson_packages immutability trigger', () => {
  it('updating amount_kopecks with active purchase → trigger refuses', async () => {
    const admin = await regAdmin()
    const learner = await regLearner()
    // Create package + purchase by learner
    const pool = getDbPool()
    const pkgRow = await pool.query(
      `insert into lesson_packages (slug, title_ru, duration_minutes, count, amount_kopecks)
       values ('pr4-trigger-pkg', 'Trigger', 60, 5, 100000) returning id`,
    )
    const pkgId = String(pkgRow.rows[0].id)

    const orderId = `lc_pr4_trigger_${Date.now()}`
    await pool.query(
      `insert into payment_orders
         (invoice_id, amount_rub, currency, description, provider, status,
          created_at, updated_at, paid_at, customer_email, receipt_email,
          receipt, metadata)
       values ($1, '1000.00', 'RUB', 'T', 'mock', 'paid',
               now(), now(), now(), 'x@example.com', 'x@example.com',
               '{}'::jsonb, '{}'::jsonb)`,
      [orderId],
    )
    await pool.query(
      `insert into package_purchases
         (account_id, package_id, payment_order_id, amount_kopecks,
          title_snapshot, duration_minutes, count_initial, expires_at)
       values ($1, $2, $3, 100000, 'Trigger', 60, 5, now() + interval '6 months')`,
      [learner.accountId, pkgId, orderId],
    )

    // Now try to UPDATE the price. The trigger raises with SQLSTATE
    // 23514 (check_violation) — match on the SQLSTATE, not on the
    // human-readable text, which can drift with translations or
    // future trigger refactors. Codex 2026-05-10 (Pass 3 #18).
    let threw = false
    try {
      await pool.query(
        `update lesson_packages set amount_kopecks = 200000 where id = $1`,
        [pkgId],
      )
    } catch (e) {
      threw = true
      expect((e as { code?: string }).code).toBe('23514')
    }
    expect(threw).toBe(true)
    void admin
  })
})
