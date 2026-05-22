import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { POST as checkoutPackageHandler } from '@/app/api/checkout/package/[slug]/route'
import { POST as chargeTokenHandler } from '@/app/api/payments/charge-token/route'
import { POST as sbpCreateQrHandler } from '@/app/api/payments/sbp/create-qr/route'
import { POST as teacherPackagesPost } from '@/app/api/teacher/packages/route'
import { POST as loginHandler } from '@/app/api/auth/login/route'
import { POST as registerHandler } from '@/app/api/auth/register/route'
import {
  getAccountByEmail,
  grantAccountRole,
  markAccountVerified,
} from '@/lib/auth/accounts'
import { getAuthPool } from '@/lib/auth/pool'
import {
  SESSION_COOKIE_NAME,
  createSession,
} from '@/lib/auth/sessions'
import { getDbPool } from '@/lib/db/pool'
import { loadTeacherBlocks } from '@/lib/cabinet/teacher-blocks'

import '../setup'
import { buildRequest, extractSessionCookie } from '../helpers'

// SAAS-PIVOT security-audit (2026-05-23) — HIGH-1..HIGH-4 closures.
//
// Audit report: /tmp/saas-pivot-security-audit-2026-05-23.md
//
// HIGH-1: /api/checkout/package/[slug] without ?packageId or ?teacher
//          must 400 when the slug is ambiguous across teachers.
// HIGH-2: POST /api/teacher/packages must 422 plan_4_required for
//          non-plan-4 teachers, and 201 for plan-4 (operator-managed).
// HIGH-3: loadTeacherBlocks must return per-teacher active package
//          counts, not learner-wide.
// HIGH-4: POST /api/payments/sbp/create-qr and
//          POST /api/payments/charge-token must reject non-plan-4
//          teachers with 422 plan_4_required.

vi.mock('@/lib/email/dispatch', () => ({
  sendVerifyEmail: vi.fn().mockResolvedValue({ ok: true }),
  sendAlreadyRegisteredEmail: vi.fn().mockResolvedValue({ ok: true }),
  sendPasswordResetEmail: vi.fn().mockResolvedValue({ ok: true }),
}))

beforeAll(() => {
  vi.stubEnv('BILLING_WAVE_ACTIVE', 'true')
  vi.stubEnv('PAYMENTS_PROVIDER', 'mock')
  vi.stubEnv('PAYMENTS_ALLOW_MOCK_CONFIRM', 'true')
  // SBP create-qr is operator-disabled by default; flip it on for the
  // HIGH-4 test (we never reach the CP API — the plan-4 gate fires
  // first).
  vi.stubEnv('SBP_ENABLED', 'true')
})

afterAll(() => {
  vi.unstubAllEnvs()
})

async function makeTeacher(opts: {
  emailSuffix: string
  planSlug: string | null
  publicSlug?: string | null
}): Promise<{ id: string; email: string; publicSlug: string | null }> {
  const email = `audit-${opts.emailSuffix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`.toLowerCase()
  const authPool = getAuthPool()
  const r = await authPool.query<{ id: string }>(
    `insert into accounts (email, password_hash, email_verified_at)
       values ($1, 'fake-hash-audit-tests', now())
     returning id`,
    [email],
  )
  const id = r.rows[0].id
  await grantAccountRole(id, 'teacher', null)
  if (opts.planSlug) {
    await authPool.query(
      `insert into teacher_subscriptions (account_id, plan_slug, state)
         values ($1::uuid, $2, 'active')
         on conflict (account_id) do update
           set plan_slug = excluded.plan_slug, state = 'active'`,
      [id, opts.planSlug],
    )
  }
  if (opts.publicSlug) {
    await authPool.query(
      `insert into account_profiles (account_id, teacher_public_slug, display_name, timezone, locale)
         values ($1::uuid, $2, 'T', 'Europe/Moscow', 'ru')
         on conflict (account_id) do update
           set teacher_public_slug = excluded.teacher_public_slug`,
      [id, opts.publicSlug],
    )
  }
  return { id, email, publicSlug: opts.publicSlug ?? null }
}

async function registerLearner(email: string): Promise<{
  cookie: string
  accountId: string
  email: string
}> {
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

async function teacherCookie(teacherId: string): Promise<string> {
  const session = await createSession({ accountId: teacherId })
  return `${SESSION_COOKIE_NAME}=${session.cookieValue}`
}

async function createPackageOwnedBy(
  teacherId: string,
  slug: string,
  durationMinutes = 60,
  amountKopecks = 100000,
): Promise<{ id: string; slug: string }> {
  const r = await getDbPool().query<{ id: string; slug: string }>(
    `insert into lesson_packages
       (slug, title_ru, description_ru, duration_minutes, count, amount_kopecks,
        is_active, display_order, teacher_id)
     values ($1, $2, null, $3, 5, $4, true, 100, $5::uuid)
     returning id, slug`,
    [slug, `Audit pkg ${slug}`, durationMinutes, amountKopecks, teacherId],
  )
  return r.rows[0]
}

describe('SAAS-PIVOT security-audit HIGH-1 — /api/checkout/package/[slug] disambiguation', () => {
  it('returns 400 package_slug_ambiguous when two teachers own the same slug and no disambiguator is passed', async () => {
    const SLUG = 'audit-h1-shared'
    const teacherA = await makeTeacher({
      emailSuffix: 'h1-a',
      planSlug: 'operator-managed',
    })
    const teacherB = await makeTeacher({
      emailSuffix: 'h1-b',
      planSlug: 'operator-managed',
    })
    await createPackageOwnedBy(teacherA.id, SLUG)
    await createPackageOwnedBy(teacherB.id, SLUG)
    const learner = await registerLearner('audit-h1-learner@example.com')

    const r = await checkoutPackageHandler(
      buildRequest(`/api/checkout/package/${SLUG}`, {
        cookie: learner.cookie,
        body: {},
      }),
      { params: Promise.resolve({ slug: SLUG }) },
    )
    expect(r.status).toBe(400)
    const body = await r.json()
    expect(body.error).toBe('package_slug_ambiguous')
  })

  it('with ?teacher=<A> returns the A-owned package row', async () => {
    const SLUG = 'audit-h1-disambig'
    const teacherA = await makeTeacher({
      emailSuffix: 'h1-da',
      planSlug: 'operator-managed',
    })
    const teacherB = await makeTeacher({
      emailSuffix: 'h1-db',
      planSlug: 'operator-managed',
    })
    const pkgA = await createPackageOwnedBy(teacherA.id, SLUG, 60, 100000)
    await createPackageOwnedBy(teacherB.id, SLUG, 60, 200000)
    const learner = await registerLearner('audit-h1-disambig-learner@example.com')

    const r = await checkoutPackageHandler(
      buildRequest(
        `/api/checkout/package/${SLUG}?teacher=${encodeURIComponent(teacherA.id)}`,
        { cookie: learner.cookie, body: {} },
      ),
      { params: Promise.resolve({ slug: SLUG }) },
    )
    expect(r.status).toBe(200)
    const body = await r.json()
    expect(body.invoiceId).toBeTruthy()

    const orderRow = await getDbPool().query<{
      teacher_account_id: string
      metadata: { packageId: string }
    }>(
      `select teacher_account_id, metadata from payment_orders where invoice_id = $1`,
      [body.invoiceId],
    )
    expect(orderRow.rows[0]?.teacher_account_id).toBe(teacherA.id)
    expect(orderRow.rows[0]?.metadata.packageId).toBe(pkgA.id)
  })

  it('with ?packageId=<uuid> returns that exact row even when slug is ambiguous', async () => {
    const SLUG = 'audit-h1-pkg-id'
    const teacherA = await makeTeacher({
      emailSuffix: 'h1-pa',
      planSlug: 'operator-managed',
    })
    const teacherB = await makeTeacher({
      emailSuffix: 'h1-pb',
      planSlug: 'operator-managed',
    })
    await createPackageOwnedBy(teacherA.id, SLUG)
    const pkgB = await createPackageOwnedBy(teacherB.id, SLUG)
    const learner = await registerLearner('audit-h1-pkgid-learner@example.com')

    const r = await checkoutPackageHandler(
      buildRequest(
        `/api/checkout/package/${SLUG}?packageId=${encodeURIComponent(pkgB.id)}`,
        { cookie: learner.cookie, body: {} },
      ),
      { params: Promise.resolve({ slug: SLUG }) },
    )
    expect(r.status).toBe(200)
    const body = await r.json()
    const orderRow = await getDbPool().query<{ teacher_account_id: string }>(
      `select teacher_account_id from payment_orders where invoice_id = $1`,
      [body.invoiceId],
    )
    expect(orderRow.rows[0]?.teacher_account_id).toBe(teacherB.id)
  })

  it('round-1 BLOCKER#2 closure — buying a non-plan-4 teacher\'s package returns 422 plan_4_required', async () => {
    const SLUG = 'audit-h2-buyside'
    const teacher = await makeTeacher({
      emailSuffix: 'h2-buy-free',
      planSlug: 'free',
    })
    const pkg = await createPackageOwnedBy(teacher.id, SLUG)
    const learner = await registerLearner('audit-h2-buyside-learner@example.com')

    const r = await checkoutPackageHandler(
      buildRequest(
        `/api/checkout/package/${SLUG}?packageId=${encodeURIComponent(pkg.id)}`,
        { cookie: learner.cookie, body: {} },
      ),
      { params: Promise.resolve({ slug: SLUG }) },
    )
    expect(r.status).toBe(422)
    const body = await r.json()
    expect(body.error).toBe('plan_4_required')
  })

  it('with ?packageId pointing at a different slug returns 404 (confused-deputy refused)', async () => {
    const SLUG_URL = 'audit-h1-url-slug'
    const SLUG_REAL = 'audit-h1-real-slug'
    const teacher = await makeTeacher({
      emailSuffix: 'h1-cd',
      planSlug: 'operator-managed',
    })
    const pkgUrl = await createPackageOwnedBy(teacher.id, SLUG_URL)
    const pkgOther = await createPackageOwnedBy(teacher.id, SLUG_REAL)
    const learner = await registerLearner('audit-h1-cd-learner@example.com')

    // URL says SLUG_URL, but ?packageId points at the OTHER row.
    const r = await checkoutPackageHandler(
      buildRequest(
        `/api/checkout/package/${SLUG_URL}?packageId=${encodeURIComponent(pkgOther.id)}`,
        { cookie: learner.cookie, body: {} },
      ),
      { params: Promise.resolve({ slug: SLUG_URL }) },
    )
    expect(r.status).toBe(404)
    void pkgUrl
  })
})

describe('SAAS-PIVOT security-audit HIGH-2 — POST /api/teacher/tariffs plan-4 gate', () => {
  it('rejects a free-plan teacher with 422 plan_4_required', async () => {
    const { POST: teacherTariffsPost } = await import(
      '@/app/api/teacher/tariffs/route'
    )
    const teacher = await makeTeacher({
      emailSuffix: 'h2t-free',
      planSlug: 'free',
    })
    const cookie = await teacherCookie(teacher.id)
    const r = await teacherTariffsPost(
      buildRequest('/api/teacher/tariffs', {
        cookie,
        body: {
          titleRu: 'Should be rejected',
          amountKopecks: 100000,
          durationMinutes: 60,
        },
      }),
    )
    expect(r.status).toBe(422)
    const body = await r.json()
    expect(body.error).toBe('plan_4_required')
  })

  it('accepts a plan-4 teacher with 201', async () => {
    const { POST: teacherTariffsPost } = await import(
      '@/app/api/teacher/tariffs/route'
    )
    const teacher = await makeTeacher({
      emailSuffix: 'h2t-p4',
      planSlug: 'operator-managed',
    })
    const cookie = await teacherCookie(teacher.id)
    const r = await teacherTariffsPost(
      buildRequest('/api/teacher/tariffs', {
        cookie,
        body: {
          titleRu: 'Plan-4 OK',
          amountKopecks: 100000,
          durationMinutes: 60,
        },
      }),
    )
    expect(r.status).toBe(201)
  })
})

describe('SAAS-PIVOT security-audit HIGH-2 — POST /api/teacher/packages plan-4 gate', () => {
  it('rejects a free-plan teacher with 422 plan_4_required', async () => {
    const teacher = await makeTeacher({
      emailSuffix: 'h2-free',
      planSlug: 'free',
    })
    const cookie = await teacherCookie(teacher.id)
    const r = await teacherPackagesPost(
      buildRequest('/api/teacher/packages', {
        cookie,
        body: {
          slug: 'h2-free-pkg',
          titleRu: 'Should be rejected',
          durationMinutes: 60,
          count: 10,
          amountKopecks: 100000,
        },
      }),
    )
    expect(r.status).toBe(422)
    const body = await r.json()
    expect(body.error).toBe('plan_4_required')
  })

  it('rejects a teacher with NO subscription row at all with 422 plan_4_required', async () => {
    const teacher = await makeTeacher({
      emailSuffix: 'h2-none',
      planSlug: null,
    })
    const cookie = await teacherCookie(teacher.id)
    const r = await teacherPackagesPost(
      buildRequest('/api/teacher/packages', {
        cookie,
        body: {
          slug: 'h2-none-pkg',
          titleRu: 'Should be rejected',
          durationMinutes: 60,
          count: 10,
          amountKopecks: 100000,
        },
      }),
    )
    expect(r.status).toBe(422)
    const body = await r.json()
    expect(body.error).toBe('plan_4_required')
  })

  it('accepts a plan-4 (operator-managed) teacher with 201', async () => {
    const teacher = await makeTeacher({
      emailSuffix: 'h2-p4',
      planSlug: 'operator-managed',
    })
    const cookie = await teacherCookie(teacher.id)
    const r = await teacherPackagesPost(
      buildRequest('/api/teacher/packages', {
        cookie,
        body: {
          slug: 'h2-p4-pkg',
          titleRu: 'Plan-4 OK',
          durationMinutes: 60,
          count: 10,
          amountKopecks: 100000,
        },
      }),
    )
    expect(r.status).toBe(201)
    const body = await r.json()
    expect(body.package.slug).toBe('h2-p4-pkg')
  })
})

describe('SAAS-PIVOT security-audit HIGH-3 — loadTeacherBlocks per-teacher active package count', () => {
  it('counts only packages owned by the block teacher (not learner-wide)', async () => {
    const teacherA = await makeTeacher({
      emailSuffix: 'h3-a',
      planSlug: 'operator-managed',
    })
    const teacherB = await makeTeacher({
      emailSuffix: 'h3-b',
      planSlug: 'operator-managed',
    })
    const learnerEmail = `audit-h3-learner-${Date.now()}@example.com`.toLowerCase()
    const learnerRow = await getAuthPool().query<{ id: string }>(
      `insert into accounts (email, password_hash, email_verified_at)
         values ($1, 'fake-hash-audit-tests', now())
       returning id`,
      [learnerEmail],
    )
    const learnerId = learnerRow.rows[0].id

    // Two active packages owned by teacher A, one by teacher B.
    // Each purchase needs a backing payment_orders row (NOT NULL FK).
    async function seedActivePurchase(teacherId: string, label: string) {
      const pkg = await createPackageOwnedBy(
        teacherId,
        `h3-${label}-${randomUUID().slice(0, 6)}`,
        60,
        100000,
      )
      const invoiceId = `lc_h3_${randomUUID().replace(/-/g, '').slice(0, 14)}`
      await getDbPool().query(
        `insert into payment_orders
           (invoice_id, amount_rub, currency, description, provider, status,
            created_at, updated_at, paid_at, customer_email, receipt_email,
            receipt, teacher_account_id)
         values ($1, 1000, 'RUB', 'h3 fixture', 'mock', 'paid',
                 now(), now(), now(), 'h3@example.com', 'h3@example.com',
                 '{}'::jsonb, $2::uuid)`,
        [invoiceId, teacherId],
      )
      await getDbPool().query(
        `insert into package_purchases (
           account_id, package_id, payment_order_id, teacher_id,
           amount_kopecks, currency,
           title_snapshot, duration_minutes, count_initial,
           expires_at, voided_at
         )
         values (
           $1::uuid, $2::uuid, $3, $4::uuid,
           100000, 'RUB',
           $5, 60, 5,
           now() + interval '30 days', null
         )`,
        [learnerId, pkg.id, invoiceId, teacherId, `Snapshot ${label}`],
      )
    }
    await seedActivePurchase(teacherA.id, 'a1')
    await seedActivePurchase(teacherA.id, 'a2')
    await seedActivePurchase(teacherB.id, 'b1')

    const blocks = await loadTeacherBlocks(learnerId, [teacherA.id, teacherB.id])
    expect(blocks).toHaveLength(2)
    const blockA = blocks.find((b) => b.teacherId === teacherA.id)!
    const blockB = blocks.find((b) => b.teacherId === teacherB.id)!
    expect(blockA.activePackageCount).toBe(2)
    expect(blockB.activePackageCount).toBe(1)
  })
})

describe('SAAS-PIVOT security-audit HIGH-4 — payment surfaces plan-4 gate', () => {
  it('SBP create-qr rejects a non-plan-4 teacher with 422 plan_4_required', async () => {
    // Wipe bootstrap so derivation doesn't accidentally route to a
    // plan-4 bootstrap row (the resolver falls back to bootstrap when
    // ?t= is missing, and bootstrap is plan-4 in some scenarios).
    await getDbPool().query(
      `delete from accounts where teacher_account_migration_marker = 'bootstrap-2026-05-22'`,
    )
    const publicSlug = `h4-sbp-${randomUUID().slice(0, 6)}`
    await makeTeacher({
      emailSuffix: 'h4-sbp',
      planSlug: 'mid',
      publicSlug,
    })

    const r = await sbpCreateQrHandler(
      buildRequest(`/api/payments/sbp/create-qr?t=${encodeURIComponent(publicSlug)}`, {
        body: {
          amountRub: 2500,
          customerEmail: 'audit-h4@example.com',
          personalDataConsentAccepted: true,
        },
        headers: { 'Idempotency-Key': randomUUID() },
      }),
    )
    expect(r.status).toBe(422)
    const body = await r.json()
    expect(body.error).toBe('plan_4_required')
  })

  it('charge-token rejects a non-plan-4 teacher with 422 plan_4_required (runtime gate)', async () => {
    // charge-token reads `paymentConfig.provider` at module-load time
    // (lib/payments/config.ts:28). The route module captured
    // `provider='mock'` at the top-level import above, so we can't
    // flip the early gate after the fact.
    //
    // To actually exercise the runtime plan-4 gate (round-1 WARN#3
    // closure), we vi.resetModules() then dynamically re-import
    // BOTH `lib/payments/config` and the charge-token route inside a
    // `PAYMENTS_PROVIDER=cloudpayments` env window. The fresh route
    // module captures `provider='cloudpayments'`, the early
    // 503-gate is bypassed, and the plan-4 gate fires when we feed
    // it a non-plan-4 ?t=<slug>.
    vi.stubEnv('PAYMENTS_PROVIDER', 'cloudpayments')
    vi.resetModules()
    try {
      await getDbPool().query(
        `delete from accounts where teacher_account_migration_marker = 'bootstrap-2026-05-22'`,
      )
      const publicSlug = `h4-ct-rt-${randomUUID().slice(0, 6)}`
      await makeTeacher({
        emailSuffix: 'h4-ct-rt',
        planSlug: 'pro',
        publicSlug,
      })
      const learner = await registerLearner('audit-h4-ct-rt-learner@example.com')

      // Dynamic import so the fresh module reads the stubbed env.
      const routeModule = await import('@/app/api/payments/charge-token/route')
      const r = await routeModule.POST(
        buildRequest(
          `/api/payments/charge-token?t=${encodeURIComponent(publicSlug)}`,
          {
            cookie: learner.cookie,
            body: {
              amountRub: 1500,
              personalDataConsentAccepted: true,
            },
            headers: { 'Idempotency-Key': randomUUID() },
          },
        ),
      )
      expect(r.status).toBe(422)
      const body = await r.json()
      expect(body.error).toBe('plan_4_required')
    } finally {
      vi.stubEnv('PAYMENTS_PROVIDER', 'mock')
      vi.resetModules()
    }

    // Touch chargeTokenHandler so the static import is still
    // exercised (lint guard).
    expect(typeof chargeTokenHandler).toBe('function')
  })
})
