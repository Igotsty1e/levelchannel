import { afterAll, beforeAll, describe, expect, it } from 'vitest'

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
import {
  buildRequest,
  extractSessionCookie,
  freshInvoiceId,
  seedBootstrapTeacher,
} from '../helpers'

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

// Quality Sub-PR A (2026-06-02): the
// describe('POST /api/admin/accounts/[id]/postpaid', ...) block was
// removed along with the deleted endpoint. The dead column
// accounts.postpaid_allowed is dropped in mig 0103; per-pair payment
// method now lives in learner_billing_preferences (mig 0101).

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
    // SAAS-PIVOT Epic 3 Day 4 (mig 0089): lesson_packages.teacher_id +
    // package_purchases.teacher_id NOT NULL — attribute to bootstrap.
    const teacherId = await seedBootstrapTeacher()
    const pkgRow = await pool.query(
      `insert into lesson_packages (slug, title_ru, duration_minutes, count, amount_kopecks, teacher_id)
       values ('pr4-trigger-pkg', 'Trigger', 60, 5, 100000, $1::uuid) returning id`,
      [teacherId],
    )
    const pkgId = String(pkgRow.rows[0].id)

    const orderId = freshInvoiceId('lc_pr4_trigger')
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
          title_snapshot, duration_minutes, count_initial, expires_at, teacher_id)
       values ($1, $2, $3, 100000, 'Trigger', 60, 5, now() + interval '6 months', $4::uuid)`,
      [learner.accountId, pkgId, orderId, teacherId],
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
