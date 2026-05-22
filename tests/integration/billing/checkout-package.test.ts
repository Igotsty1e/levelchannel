import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { POST as checkoutPackageHandler } from '@/app/api/checkout/package/[slug]/route'
import { GET as paymentStatusHandler } from '@/app/api/payments/[invoiceId]/route'
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
import { buildRequest, extractSessionCookie, freshInvoiceId } from '../helpers'

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

  // PKG-LEARNER-BUY LBL.0 — auth gate swap to
  // requireLearnerArchetypeAndVerified + isLearnerArchetypeCandidate.
  it('admin role → wrong_role 403', async () => {
    const { grantAccountRole } = await import('@/lib/auth/accounts')
    const learner = await reg('pr2-admin-403@example.com')
    await grantAccountRole(learner.accountId, 'admin', null)
    const pkg = await createPackage({
      slug: 'pr2-admin-403-pkg',
      titleRu: 'Admin reject',
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
    expect(r.status).toBe(403)
    const body = await r.json()
    expect(body.error).toBe('wrong_role')
  })

  it('teacher role → wrong_role 403', async () => {
    const { grantAccountRole } = await import('@/lib/auth/accounts')
    const learner = await reg('pr2-teacher-403@example.com')
    await grantAccountRole(learner.accountId, 'teacher', null)
    const pkg = await createPackage({
      slug: 'pr2-teacher-403-pkg',
      titleRu: 'Teacher reject',
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
    expect(r.status).toBe(403)
    const body = await r.json()
    expect(body.error).toBe('wrong_role')
  })

  it('deletion-grace (scheduled_purge_at set) → learner_target_unavailable 403', async () => {
    const learner = await reg('pr2-purge-403@example.com')
    await getDbPool().query(
      `update accounts set scheduled_purge_at = now() + interval '30 days' where id = $1`,
      [learner.accountId],
    )
    const pkg = await createPackage({
      slug: 'pr2-purge-403-pkg',
      titleRu: 'Purge reject',
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
    expect(r.status).toBe(403)
    const body = await r.json()
    expect(body.error).toBe('learner_target_unavailable')
  })

  // PKG-LEARNER-BUY LBL.0 — pending + active-owned gates.
  it('pending order in last 15 min → 409 pending_package_in_flight', async () => {
    const learner = await reg('pr2-pending-409@example.com')
    const pkg = await createPackage({
      slug: 'pr2-pending-409-pkg',
      titleRu: 'Pending gate',
      durationMinutes: 60,
      count: 5,
      amountKopecks: 100_00,
    })
    // Seed a pending order on a different invoice for the same
    // (account, duration). Status='pending' so it counts.
    await getDbPool().query(
      `insert into payment_orders (
         invoice_id, amount_rub, currency, description, provider, status,
         created_at, updated_at, customer_email, receipt_email, receipt, metadata
       ) values (
         $1, 100, 'RUB', 'pending test', 'cloudpayments', 'pending',
         now(), now(), $2, $2, '{}'::jsonb, $3::jsonb
       )`,
      [
        freshInvoiceId('lc_pend'),
        learner.email,
        JSON.stringify({
          accountId: learner.accountId,
          packageSlug: pkg.slug,
          packageDurationMinutes: 60,
        }),
      ],
    )
    const r = await checkoutPackageHandler(
      buildRequest(`/api/checkout/package/${pkg.slug}`, {
        cookie: learner.cookie,
        body: {},
      }),
      { params: Promise.resolve({ slug: pkg.slug }) },
    )
    expect(r.status).toBe(409)
    const body = await r.json()
    expect(body.error).toBe('pending_package_in_flight')
  })

  it('already-owned active package of same duration → 409 already_owns_active_package', async () => {
    const learner = await reg('pr2-owned-409@example.com')
    const pkg = await createPackage({
      slug: 'pr2-owned-409-pkg',
      titleRu: 'Owned 60min',
      durationMinutes: 60,
      count: 5,
      amountKopecks: 100_00,
    })
    // Seed an active 60-min purchase directly. Need a payment_orders
    // row first (FK).
    const seedInvoice = freshInvoiceId('lc_seedpkg')
    await getDbPool().query(
      `insert into payment_orders (
         invoice_id, amount_rub, currency, description, provider, status,
         created_at, updated_at, paid_at, customer_email, receipt_email,
         receipt, metadata
       ) values (
         $1, 100, 'RUB', 'seed', 'mock', 'paid',
         now(), now(), now(), $2, $2, '{}'::jsonb, '{}'::jsonb
       )`,
      [seedInvoice, learner.email],
    )
    const ownedId = (
      await getDbPool().query(
        // SAAS-PIVOT Epic 3 Day 4 (mig 0089): package_purchases.teacher_id
        // NOT NULL — inherit from the package row's owning teacher.
        `insert into package_purchases (
           account_id, package_id, payment_order_id, amount_kopecks,
           title_snapshot, duration_minutes, count_initial, expires_at, teacher_id
         ) values ($1, $2, $3,
                   $4, $5, $6, $7, now() + interval '30 days', $8::uuid)
         returning id`,
        [
          learner.accountId,
          pkg.id,
          seedInvoice,
          pkg.amountKopecks,
          pkg.titleRu,
          pkg.durationMinutes,
          pkg.count,
          pkg.teacherId,
        ],
      )
    ).rows[0].id
    expect(typeof ownedId).toBe('string')
    const r = await checkoutPackageHandler(
      buildRequest(`/api/checkout/package/${pkg.slug}`, {
        cookie: learner.cookie,
        body: {},
      }),
      { params: Promise.resolve({ slug: pkg.slug }) },
    )
    expect(r.status).toBe(409)
    const body = await r.json()
    expect(body.error).toBe('already_owns_active_package')
    expect(body.existingPurchaseId).toBe(ownedId)
  })

  // PKG-LEARNER-BUY LBL.0 — production widget intent. In mock mode,
  // checkoutIntent is null; the cloudpayments path is exercised by
  // flipping the env stub.
  it('mock provider returns checkoutIntent=null', async () => {
    const learner = await reg('pr2-intent-mock@example.com')
    const pkg = await createPackage({
      slug: 'pr2-intent-mock-pkg',
      titleRu: 'Mock intent',
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
    const body = await r.json()
    expect(body.checkoutIntent).toBeNull()
    expect(body.receiptToken).toBeTruthy()
  })

  it('cloudpayments provider returns checkoutIntent with externalId == invoiceId', async () => {
    vi.stubEnv('PAYMENTS_PROVIDER', 'cloudpayments')
    vi.stubEnv('PAYMENTS_ALLOW_MOCK_CONFIRM', '')
    // Minimal CP credentials so buildCloudPaymentsWidgetIntent has a
    // publicId to put in the response. The widget never actually
    // fires in tests.
    vi.stubEnv('CLOUDPAYMENTS_PUBLIC_ID', 'pk_test_public')
    vi.stubEnv('CLOUDPAYMENTS_API_SECRET', 'sk_test_secret')
    try {
      const learner = await reg('pr2-intent-cp@example.com')
      const pkg = await createPackage({
        slug: 'pr2-intent-cp-pkg',
        titleRu: 'CP intent',
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
      const body = await r.json()
      expect(body.checkoutIntent).toBeTruthy()
      expect(body.checkoutIntent.externalId).toBe(body.invoiceId)
      expect(body.checkoutIntent.description).toBe(`Пакет: ${pkg.titleRu}`)
      expect(body.status).toBe('pending')
      // Epic-end paranoia BLOCKER #2 regression — successRedirectUrl
      // MUST carry the same plain receipt token that was returned in
      // the response body, otherwise /thank-you 401s on its polling.
      expect(typeof body.receiptToken).toBe('string')
      expect(body.checkoutIntent.successRedirectUrl).toContain('/thank-you')
      expect(body.checkoutIntent.successRedirectUrl).toContain(
        `&token=${encodeURIComponent(body.receiptToken)}`,
      )
      expect(body.checkoutIntent.successRedirectUrl).toContain(
        `invoiceId=${encodeURIComponent(body.invoiceId)}`,
      )
    } finally {
      vi.stubEnv('PAYMENTS_PROVIDER', 'mock')
      vi.stubEnv('PAYMENTS_ALLOW_MOCK_CONFIRM', 'true')
    }
  })

  // PKG-LEARNER-BUY LBL.2 — receipt-token threading regression.
  //
  // The /thank-you page polls GET /api/payments/[invoiceId] with the
  // plain receipt token in X-Receipt-Token. The buy-button + tariff
  // checkout-form now thread the token into the redirect URL so the
  // page can forward it as a header. Without the token, the gate
  // returns 401 — which would silently break /thank-you for ALL
  // package buyers.
  it('GET /api/payments/[invoiceId] with X-Receipt-Token succeeds; without it returns 401', async () => {
    const learner = await reg('pr2-receipt-gate@example.com')
    const pkg = await createPackage({
      slug: 'pr2-receipt-gate-pkg',
      titleRu: 'Receipt gate',
      durationMinutes: 60,
      count: 5,
      amountKopecks: 100_00,
    })
    const buyRes = await checkoutPackageHandler(
      buildRequest(`/api/checkout/package/${pkg.slug}`, {
        cookie: learner.cookie,
        body: {},
      }),
      { params: Promise.resolve({ slug: pkg.slug }) },
    )
    expect(buyRes.status).toBe(200)
    const buyBody = await buyRes.json()
    const invoiceId = buyBody.invoiceId as string
    const receiptToken = buyBody.receiptToken as string
    expect(typeof invoiceId).toBe('string')
    expect(typeof receiptToken).toBe('string')

    // With token: 200 with order shape.
    const okRes = await paymentStatusHandler(
      buildRequest(`/api/payments/${invoiceId}`, {
        method: 'GET',
        headers: { 'X-Receipt-Token': receiptToken },
      }),
      { params: Promise.resolve({ invoiceId }) },
    )
    expect(okRes.status).toBe(200)
    const okBody = await okRes.json()
    expect(okBody.order?.invoiceId).toBe(invoiceId)

    // Without token: 401 (gate enforced).
    const denyRes = await paymentStatusHandler(
      buildRequest(`/api/payments/${invoiceId}`, { method: 'GET' }),
      { params: Promise.resolve({ invoiceId }) },
    )
    expect(denyRes.status).toBe(401)
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
    const invoiceId = freshInvoiceId('lc_pr2_tamper')
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
    const invoiceId = freshInvoiceId('lc_pr2_no_acc')
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
    const invoiceId = freshInvoiceId('lc_pr2_unknown')
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
