import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { POST as checkoutPackageHandler } from '@/app/api/checkout/package/[slug]/route'
import { GET as accountPackagesHandler } from '@/app/api/account/packages/route'
import { POST as loginHandler } from '@/app/api/auth/login/route'
import { POST as registerHandler } from '@/app/api/auth/register/route'
import {
  getAccountByEmail,
  markAccountVerified,
} from '@/lib/auth/accounts'
import { createPackage } from '@/lib/billing/packages'
import { processPackageGrant } from '@/lib/billing/package-grant'
import { getDbPool } from '@/lib/db/pool'

import '../setup'
import { buildRequest, extractSessionCookie } from '../helpers'

// Billing wave PR 2 — public surface + webhook ownership tests.
//
// Mock auto-confirm path (PAYMENTS_PROVIDER=mock + PAYMENTS_ALLOW_MOCK_CONFIRM=true)
// is the test default — POST /api/checkout/package/[slug] inserts
// the order with status='paid' and inline-fires processPackageGrant,
// which exercises the dual-source corroboration contract.

beforeAll(() => {
  // Use vi.stubEnv so leaks into later integration files in the same
  // worker are auto-cleaned. Codex 2026-05-10 (Pass 3 #1): direct
  // process.env writes don't get restored if a later afterAll throws,
  // and PAYMENTS_PROVIDER/PAYMENTS_ALLOW_MOCK_CONFIRM were never
  // restored at all in the prior version.
  vi.stubEnv('BILLING_WAVE_ACTIVE', 'true')
  vi.stubEnv('PAYMENTS_PROVIDER', 'mock')
  vi.stubEnv('PAYMENTS_ALLOW_MOCK_CONFIRM', 'true')
})

afterAll(() => {
  vi.unstubAllEnvs()
})

async function reg(email: string) {
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
  return {
    cookie: extractSessionCookie(login.headers.get('Set-Cookie'))!,
    accountId: created!.id,
    email,
  }
}

describe('POST /api/checkout/package/[slug] — server-authored metadata', () => {
  it('creates order with metadata.{accountId, packageSlug, packageDurationMinutes} from session + URL', async () => {
    const learner = await reg('pr2-checkout@example.com')
    const pkg = await createPackage({
      slug: 'pr2-checkout-pkg',
      titleRu: '5 уроков по 60 мин',
      durationMinutes: 60,
      count: 5,
      amountKopecks: 17500_00,
    })
    const r = await checkoutPackageHandler(
      buildRequest(`/api/checkout/package/${pkg.slug}`, {
        cookie: learner.cookie,
        body: {},
      }),
      { params: Promise.resolve({ slug: pkg.slug }) },
    )
    expect(r.status).toBe(200)
    const body = await r.json()
    const orderRow = await getDbPool().query(
      `select customer_email, metadata, status from payment_orders where invoice_id = $1`,
      [body.invoiceId],
    )
    expect(orderRow.rows.length).toBe(1)
    const row = orderRow.rows[0]
    expect(row.customer_email).toBe(learner.email)
    expect(row.metadata.accountId).toBe(learner.accountId)
    expect(row.metadata.packageSlug).toBe(pkg.slug)
    expect(row.metadata.packageDurationMinutes).toBe(60)
    // Mock auto-confirm fires inline: status should be paid.
    expect(row.status).toBe('paid')
  })

  it('client-supplied accountId in body is IGNORED (server-authored only)', async () => {
    const learner = await reg('pr2-spoof-acc@example.com')
    const otherLearner = await reg('pr2-spoof-other@example.com')
    const pkg = await createPackage({
      slug: 'pr2-spoof-pkg',
      titleRu: 'Spoof',
      durationMinutes: 60,
      count: 5,
      amountKopecks: 100_00,
    })
    const r = await checkoutPackageHandler(
      buildRequest(`/api/checkout/package/${pkg.slug}`, {
        cookie: learner.cookie,
        body: { accountId: otherLearner.accountId },
      }),
      { params: Promise.resolve({ slug: pkg.slug }) },
    )
    expect(r.status).toBe(200)
    const body = await r.json()
    const orderRow = await getDbPool().query(
      `select metadata from payment_orders where invoice_id = $1`,
      [body.invoiceId],
    )
    // Body field silently ignored; metadata pinned to session id.
    expect(orderRow.rows[0].metadata.accountId).toBe(learner.accountId)
    expect(orderRow.rows[0].metadata.accountId).not.toBe(otherLearner.accountId)
  })

  it('client-supplied customer_email in body is IGNORED (server-authored only)', async () => {
    const learner = await reg('pr2-spoof-email@example.com')
    const pkg = await createPackage({
      slug: 'pr2-spoof-email-pkg',
      titleRu: 'Email spoof',
      durationMinutes: 60,
      count: 5,
      amountKopecks: 100_00,
    })
    const r = await checkoutPackageHandler(
      buildRequest(`/api/checkout/package/${pkg.slug}`, {
        cookie: learner.cookie,
        body: { customerEmail: 'evil@attacker.com' },
      }),
      { params: Promise.resolve({ slug: pkg.slug }) },
    )
    expect(r.status).toBe(200)
    const body = await r.json()
    const orderRow = await getDbPool().query(
      `select customer_email from payment_orders where invoice_id = $1`,
      [body.invoiceId],
    )
    expect(orderRow.rows[0].customer_email).toBe(learner.email)
    expect(orderRow.rows[0].customer_email).not.toBe('evil@attacker.com')
  })

  it('anonymous → 401', async () => {
    const pkg = await createPackage({
      slug: 'pr2-anon-pkg',
      titleRu: 'Anon',
      durationMinutes: 60,
      count: 5,
      amountKopecks: 100_00,
    })
    const r = await checkoutPackageHandler(
      buildRequest(`/api/checkout/package/${pkg.slug}`, { body: {} }),
      { params: Promise.resolve({ slug: pkg.slug }) },
    )
    expect(r.status).toBe(401)
  })

  it('unknown package slug → 404', async () => {
    const learner = await reg('pr2-404@example.com')
    const r = await checkoutPackageHandler(
      buildRequest('/api/checkout/package/does-not-exist', {
        cookie: learner.cookie,
        body: {},
      }),
      { params: Promise.resolve({ slug: 'does-not-exist' }) },
    )
    expect(r.status).toBe(404)
  })
})

describe('processPackageGrant — webhook ownership contract', () => {
  it('mock auto-confirm flow grants the package end-to-end', async () => {
    const learner = await reg('pr2-grant@example.com')
    const pkg = await createPackage({
      slug: 'pr2-grant-pkg',
      titleRu: 'Grant',
      durationMinutes: 60,
      count: 5,
      amountKopecks: 100_00,
    })
    const r = await checkoutPackageHandler(
      buildRequest(`/api/checkout/package/${pkg.slug}`, {
        cookie: learner.cookie,
        body: {},
      }),
      { params: Promise.resolve({ slug: pkg.slug }) },
    )
    expect(r.status).toBe(200)
    // Inline grant fired — package_purchases row must exist.
    const purchases = await getDbPool().query(
      `select id, account_id, count_initial from package_purchases where account_id = $1`,
      [learner.accountId],
    )
    expect(purchases.rows.length).toBe(1)
    expect(Number(purchases.rows[0].count_initial)).toBe(5)
    // payment_allocations row written.
    const alloc = await getDbPool().query(
      `select kind, target_id from payment_allocations where payment_order_id = (select invoice_id from payment_orders where metadata->>'accountId' = $1 limit 1)`,
      [learner.accountId],
    )
    expect(alloc.rows.length).toBe(1)
    expect(alloc.rows[0].kind).toBe('package')
  })

  it('replay: second grant attempt for same order → already_granted (no duplicate)', async () => {
    const learner = await reg('pr2-replay@example.com')
    const pkg = await createPackage({
      slug: 'pr2-replay-pkg',
      titleRu: 'Replay',
      durationMinutes: 60,
      count: 5,
      amountKopecks: 100_00,
    })
    const r = await checkoutPackageHandler(
      buildRequest(`/api/checkout/package/${pkg.slug}`, {
        cookie: learner.cookie,
        body: {},
      }),
      { params: Promise.resolve({ slug: pkg.slug }) },
    )
    const body = await r.json()
    // First grant fired inline; call again directly.
    const replay = await processPackageGrant(body.invoiceId)
    expect(replay.kind).toBe('already_granted')
    const purchases = await getDbPool().query(
      `select count(*)::int as c from package_purchases where payment_order_id = $1`,
      [body.invoiceId],
    )
    expect(purchases.rows[0].c).toBe(1)
  })

  it('tampered metadata.accountId mismatching customer_email → metadata_email_mismatch fail-closed', async () => {
    const learner = await reg('pr2-tamper-meta@example.com')
    const otherLearner = await reg('pr2-tamper-other@example.com')
    const pkg = await createPackage({
      slug: 'pr2-tamper-pkg',
      titleRu: 'Tamper',
      durationMinutes: 60,
      count: 5,
      amountKopecks: 100_00,
    })
    // Insert a paid order DIRECTLY (bypassing checkout) with tampered
    // metadata: accountId points to otherLearner but customer_email
    // is learner.email. Webhook ownership corroboration must
    // refuse the grant.
    const invoiceId = `lc_pr2_tamper_${Date.now()}`
    await getDbPool().query(
      `insert into payment_orders
         (invoice_id, amount_rub, currency, description, provider, status,
          created_at, updated_at, paid_at, customer_email, receipt_email,
          receipt, metadata)
       values ($1, '1.00', 'RUB', 'Tamper test', 'mock', 'paid',
               now(), now(), now(), $2, $2, '{}'::jsonb, $3::jsonb)`,
      [
        invoiceId,
        learner.email,
        JSON.stringify({
          accountId: otherLearner.accountId, // tampered
          packageSlug: pkg.slug,
          packageDurationMinutes: 60,
        }),
      ],
    )
    const result = await processPackageGrant(invoiceId)
    expect(result.kind).toBe('semantic_failure')
    if (result.kind === 'semantic_failure') {
      expect(result.reason).toBe('metadata_email_mismatch')
    }
    const purchases = await getDbPool().query(
      `select count(*)::int as c from package_purchases where payment_order_id = $1`,
      [invoiceId],
    )
    expect(purchases.rows[0].c).toBe(0)
  })

  it('missing metadata.accountId → no_metadata_accountid fail-closed', async () => {
    const learner = await reg('pr2-no-acc@example.com')
    const pkg = await createPackage({
      slug: 'pr2-no-acc-pkg',
      titleRu: 'No acc',
      durationMinutes: 60,
      count: 5,
      amountKopecks: 100_00,
    })
    const invoiceId = `lc_pr2_no_acc_${Date.now()}`
    await getDbPool().query(
      `insert into payment_orders
         (invoice_id, amount_rub, currency, description, provider, status,
          created_at, updated_at, paid_at, customer_email, receipt_email,
          receipt, metadata)
       values ($1, '1.00', 'RUB', 'NoAcc', 'mock', 'paid',
               now(), now(), now(), $2, $2, '{}'::jsonb, $3::jsonb)`,
      [invoiceId, learner.email, JSON.stringify({ packageSlug: pkg.slug })],
    )
    const result = await processPackageGrant(invoiceId)
    expect(result.kind).toBe('semantic_failure')
    if (result.kind === 'semantic_failure') {
      expect(result.reason).toBe('no_metadata_accountid')
    }
  })

  it('unknown metadata.accountId → metadata_accountid_unknown fail-closed', async () => {
    const learner = await reg('pr2-unknown-acc@example.com')
    const pkg = await createPackage({
      slug: 'pr2-unknown-pkg',
      titleRu: 'Unknown',
      durationMinutes: 60,
      count: 5,
      amountKopecks: 100_00,
    })
    const invoiceId = `lc_pr2_unknown_${Date.now()}`
    await getDbPool().query(
      `insert into payment_orders
         (invoice_id, amount_rub, currency, description, provider, status,
          created_at, updated_at, paid_at, customer_email, receipt_email,
          receipt, metadata)
       values ($1, '1.00', 'RUB', 'Unknown', 'mock', 'paid',
               now(), now(), now(), $2, $2, '{}'::jsonb, $3::jsonb)`,
      [
        invoiceId,
        learner.email,
        JSON.stringify({
          accountId: '00000000-0000-0000-0000-000000000000',
          packageSlug: pkg.slug,
        }),
      ],
    )
    const result = await processPackageGrant(invoiceId)
    expect(result.kind).toBe('semantic_failure')
    if (result.kind === 'semantic_failure') {
      expect(result.reason).toBe('metadata_accountid_unknown')
    }
  })
})

describe('GET /api/account/packages', () => {
  it('returns own active packages with countRemaining', async () => {
    const learner = await reg('pr2-list@example.com')
    await createPackage({
      slug: 'pr2-list-pkg',
      titleRu: 'List',
      durationMinutes: 60,
      count: 10,
      amountKopecks: 100_00,
    })
    await checkoutPackageHandler(
      buildRequest('/api/checkout/package/pr2-list-pkg', {
        cookie: learner.cookie,
        body: {},
      }),
      { params: Promise.resolve({ slug: 'pr2-list-pkg' }) },
    )
    const r = await accountPackagesHandler(
      buildRequest('/api/account/packages', { cookie: learner.cookie }),
    )
    expect(r.status).toBe(200)
    const body = await r.json()
    expect(body.packages.length).toBe(1)
    expect(body.packages[0].countInitial).toBe(10)
    expect(body.packages[0].countRemaining).toBe(10)
  })

  it('anonymous → 401', async () => {
    const r = await accountPackagesHandler(
      buildRequest('/api/account/packages'),
    )
    expect(r.status).toBe(401)
  })
})
