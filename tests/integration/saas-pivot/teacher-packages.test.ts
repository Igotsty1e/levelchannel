import { describe, expect, it } from 'vitest'

import { POST as adminRefundsPost } from '@/app/api/admin/refunds/route'
import { POST as adminTeacherGrantRevokePost } from '@/app/api/admin/teacher-grant/[id]/revoke/route'
import { POST as teacherPackageIssuePost } from '@/app/api/teacher/packages/[id]/issue/route'
import { POST as teacherPackageRevokePost } from '@/app/api/teacher/packages/[id]/revoke/route'
import {
  GET as teacherPackagesGet,
  POST as teacherPackagesPost,
} from '@/app/api/teacher/packages/route'
import { PATCH as teacherPackageUpdatePatch } from '@/app/api/teacher/packages/[id]/route'
import { grantAccountRole } from '@/lib/auth/accounts'
import { getAuthPool } from '@/lib/auth/pool'
import {
  SESSION_COOKIE_NAME,
  createSession,
} from '@/lib/auth/sessions'
import { getDbPool } from '@/lib/db/pool'

import '../setup'
import { buildRequest } from '../helpers'

// SAAS-PIVOT Epic 3 Day 4 (2026-05-22) — teacher-owned packages +
// teacher_grant integration coverage.
//
// Plan: docs/plans/saas-pivot-master.md §3 Epic 3 + §5 Day 4.
//
// Pins:
//   1. CRUD scoped by teacher_id (anti-spoof on cross-teacher reads/writes).
//   2. teacher_grant issue path writes payment_orders + package_purchases
//      atomically with the 4 canonical fields (provider=teacher_grant,
//      status=teacher_granted, payment_method=teacher_grant,
//      granted_by_teacher_id=session).
//   3. Revoke voids the purchase and bumps status to 'teacher_revoked'
//      WITHOUT a reversal row.
//   4. Anti-spoof: teacher can't issue to unlinked learners or someone
//      else's packages.
//   5. CHECK invariants: a row violating the quadruple-CHECK fails.
//   6. Refund route rejects 'teacher_grant' with
//      `non_money_order_not_refundable`.
//   7. UNIQUE flip — duplicate (teacher, slug) fails, same slug
//      different teacher succeeds.

const TEACHER_EMAIL_A = 'teacher-pkg-a@example.com'
const TEACHER_EMAIL_B = 'teacher-pkg-b@example.com'
const LEARNER_EMAIL = 'teacher-pkg-learner@example.com'

// SAAS-PIVOT security-audit HIGH-2 (2026-05-23) closure: POST
// /api/teacher/packages now requires plan-4 (operator-managed). Tests
// seed teachers as plan-4 by default so the existing happy-path cases
// keep passing; the explicit non-plan-4 scenario in
// `security-high-closures.test.ts` flips this off.
async function makeTeacher(
  email: string,
  opts: { planSlug?: string | null } = {},
): Promise<string> {
  const pool = getAuthPool()
  const r = await pool.query<{ id: string }>(
    `insert into accounts (email, password_hash, email_verified_at)
       values ($1, 'fake-hash-teacher-pkg-tests', now())
     returning id`,
    [email],
  )
  const id = r.rows[0].id
  await grantAccountRole(id, 'teacher', null)
  const planSlug = opts.planSlug === undefined ? 'operator-managed' : opts.planSlug
  if (planSlug !== null) {
    await pool.query(
      `insert into teacher_subscriptions (account_id, plan_slug, state)
         values ($1::uuid, $2, 'active')
         on conflict (account_id) do update
           set plan_slug = excluded.plan_slug, state = 'active'`,
      [id, planSlug],
    )
  }
  return id
}

async function makeLearner(email: string): Promise<string> {
  const pool = getAuthPool()
  const r = await pool.query<{ id: string }>(
    `insert into accounts (email, password_hash, email_verified_at)
       values ($1, 'fake-hash-teacher-pkg-tests', now())
     returning id`,
    [email],
  )
  return r.rows[0].id
}

async function makeAdmin(): Promise<string> {
  const pool = getAuthPool()
  const r = await pool.query<{ id: string }>(
    `insert into accounts (email, password_hash, email_verified_at)
       values ('admin-pkg-tests@example.com', 'fake-hash-teacher-pkg-tests', now())
     returning id`,
  )
  const id = r.rows[0].id
  await grantAccountRole(id, 'admin', null)
  return id
}

async function linkLearnerToTeacher(
  learnerId: string,
  teacherId: string,
): Promise<void> {
  await getAuthPool().query(
    `insert into learner_teacher_links (learner_account_id, teacher_account_id, linked_at)
       values ($1, $2, now())
     on conflict (learner_account_id, teacher_account_id) do update
       set unlinked_at = null`,
    [learnerId, teacherId],
  )
}

async function teacherCookie(teacherId: string): Promise<string> {
  const { cookieValue } = await createSession({ accountId: teacherId })
  return `${SESSION_COOKIE_NAME}=${cookieValue}`
}

async function createDirectPackage(
  teacherId: string,
  slug: string,
  durationMinutes: number = 60,
): Promise<{ id: string; slug: string }> {
  const r = await getDbPool().query<{ id: string; slug: string }>(
    `insert into lesson_packages
       (slug, title_ru, description_ru, duration_minutes, count, amount_kopecks,
        is_active, display_order, teacher_id)
     values ($1, $2, null, $3, 10, 100000, true, 100, $4::uuid)
     returning id, slug`,
    [slug, `Package ${slug}`, durationMinutes, teacherId],
  )
  return r.rows[0]
}

describe('SAAS-PIVOT Day 4 — /api/teacher/packages CRUD (scoped by teacher_id)', () => {
  it('teacher A creates a package, teacher B cannot list/edit it', async () => {
    const teacherA = await makeTeacher(TEACHER_EMAIL_A)
    const teacherB = await makeTeacher(TEACHER_EMAIL_B)

    const cookieA = await teacherCookie(teacherA)
    const cookieB = await teacherCookie(teacherB)

    // A creates a package.
    const createRes = await teacherPackagesPost(
      buildRequest('/api/teacher/packages', {
        cookie: cookieA,
        body: {
          slug: 'a-only-pkg',
          titleRu: 'A only',
          durationMinutes: 60,
          count: 10,
          amountKopecks: 100000,
        },
      }),
    )
    expect(createRes.status).toBe(201)
    const { package: createdPkg } = await createRes.json()
    expect(createdPkg.slug).toBe('a-only-pkg')

    // B lists — sees nothing.
    const listRes = await teacherPackagesGet(
      buildRequest('/api/teacher/packages', { cookie: cookieB }),
    )
    expect(listRes.status).toBe(200)
    const bList = await listRes.json()
    expect(bList.packages).toHaveLength(0)

    // A lists — sees the row.
    const aListRes = await teacherPackagesGet(
      buildRequest('/api/teacher/packages', { cookie: cookieA }),
    )
    expect(aListRes.status).toBe(200)
    const aList = await aListRes.json()
    expect(aList.packages).toHaveLength(1)
    expect(aList.packages[0].slug).toBe('a-only-pkg')

    // B PATCH on A's package — 404.
    const patchRes = await teacherPackageUpdatePatch(
      buildRequest(`/api/teacher/packages/${createdPkg.id}`, {
        method: 'PATCH',
        cookie: cookieB,
        body: { isActive: false },
      }),
      { params: Promise.resolve({ id: createdPkg.id }) },
    )
    expect(patchRes.status).toBe(404)
  })

  it('teacher_id_forbidden when body carries teacher_id', async () => {
    const teacherA = await makeTeacher(TEACHER_EMAIL_A)
    const cookieA = await teacherCookie(teacherA)
    const createRes = await teacherPackagesPost(
      buildRequest('/api/teacher/packages', {
        cookie: cookieA,
        body: {
          slug: 'spoof-pkg',
          titleRu: 'Spoof',
          durationMinutes: 60,
          count: 10,
          amountKopecks: 100000,
          teacherId: '00000000-0000-0000-0000-000000000001',
        },
      }),
    )
    expect(createRes.status).toBe(400)
    const body = await createRes.json()
    expect(body.error).toBe('teacher_id_forbidden')
  })
})

describe('SAAS-PIVOT Day 4 — teacher_grant issue/revoke', () => {
  it('issues a teacher_grant with all 4 canonical fields + package_purchases linked', async () => {
    const teacherA = await makeTeacher(TEACHER_EMAIL_A)
    const learner = await makeLearner(LEARNER_EMAIL)
    await linkLearnerToTeacher(learner, teacherA)
    const pkg = await createDirectPackage(teacherA, 'issue-pkg')

    const cookieA = await teacherCookie(teacherA)
    const issueRes = await teacherPackageIssuePost(
      buildRequest(`/api/teacher/packages/${pkg.id}/issue`, {
        cookie: cookieA,
        body: { learnerAccountId: learner, reason: 'test grant' },
      }),
      { params: Promise.resolve({ id: pkg.id }) },
    )
    expect(issueRes.status).toBe(200)
    const { invoiceId, purchaseId } = await issueRes.json()
    expect(invoiceId).toMatch(/^lc_tg_/)

    // payment_orders row carries all 4 canonical fields + teacher_account_id.
    const orderRow = await getDbPool().query(
      `select provider, status, payment_method, granted_by_teacher_id,
              granted_by_operator_id, teacher_account_id
         from payment_orders
        where invoice_id = $1`,
      [invoiceId],
    )
    expect(orderRow.rows).toHaveLength(1)
    expect(orderRow.rows[0].provider).toBe('teacher_grant')
    expect(orderRow.rows[0].status).toBe('teacher_granted')
    expect(orderRow.rows[0].payment_method).toBe('teacher_grant')
    expect(orderRow.rows[0].granted_by_teacher_id).toBe(teacherA)
    expect(orderRow.rows[0].granted_by_operator_id).toBeNull()
    expect(orderRow.rows[0].teacher_account_id).toBe(teacherA)

    // package_purchases row references the order + carries teacher_id.
    const purchaseRow = await getDbPool().query(
      `select id, payment_order_id, teacher_id, account_id, package_id, voided_at
         from package_purchases
        where id = $1::uuid`,
      [purchaseId],
    )
    expect(purchaseRow.rows).toHaveLength(1)
    expect(purchaseRow.rows[0].payment_order_id).toBe(invoiceId)
    expect(purchaseRow.rows[0].teacher_id).toBe(teacherA)
    expect(purchaseRow.rows[0].account_id).toBe(learner)
    expect(purchaseRow.rows[0].package_id).toBe(pkg.id)
    expect(purchaseRow.rows[0].voided_at).toBeNull()
  })

  it('revokes a teacher_grant: voids purchase, status=teacher_revoked, NO reversal row', async () => {
    const teacherA = await makeTeacher(TEACHER_EMAIL_A)
    const learner = await makeLearner(LEARNER_EMAIL)
    await linkLearnerToTeacher(learner, teacherA)
    const pkg = await createDirectPackage(teacherA, 'revoke-pkg')
    const cookieA = await teacherCookie(teacherA)

    // Issue.
    const issueRes = await teacherPackageIssuePost(
      buildRequest(`/api/teacher/packages/${pkg.id}/issue`, {
        cookie: cookieA,
        body: { learnerAccountId: learner },
      }),
      { params: Promise.resolve({ id: pkg.id }) },
    )
    expect(issueRes.status).toBe(200)
    const { invoiceId } = await issueRes.json()

    // Revoke.
    const revokeRes = await teacherPackageRevokePost(
      buildRequest(`/api/teacher/packages/${invoiceId}/revoke`, {
        cookie: cookieA,
        body: {},
      }),
      { params: Promise.resolve({ id: invoiceId }) },
    )
    expect(revokeRes.status).toBe(200)
    const revokeBody = await revokeRes.json()
    expect(revokeBody.ok).toBe(true)

    // Order is teacher_revoked.
    const orderRow = await getDbPool().query(
      `select status from payment_orders where invoice_id = $1`,
      [invoiceId],
    )
    expect(orderRow.rows[0].status).toBe('teacher_revoked')

    // Purchase voided.
    const purchaseRow = await getDbPool().query(
      `select voided_at from package_purchases where payment_order_id = $1`,
      [invoiceId],
    )
    expect(purchaseRow.rows[0].voided_at).not.toBeNull()

    // NO payment_allocation_reversals row.
    const reversalRow = await getDbPool().query(
      `select count(*) as n from payment_allocation_reversals where payment_order_id = $1`,
      [invoiceId],
    )
    expect(Number(reversalRow.rows[0].n)).toBe(0)

    // Idempotency: a second revoke returns 409 already_revoked.
    const secondRes = await teacherPackageRevokePost(
      buildRequest(`/api/teacher/packages/${invoiceId}/revoke`, {
        cookie: cookieA,
        body: {},
      }),
      { params: Promise.resolve({ id: invoiceId }) },
    )
    expect(secondRes.status).toBe(409)
  })

  it('anti-spoof: teacher A cannot issue to a learner not in their link set', async () => {
    const teacherA = await makeTeacher(TEACHER_EMAIL_A)
    const teacherB = await makeTeacher(TEACHER_EMAIL_B)
    const learner = await makeLearner(LEARNER_EMAIL)
    await linkLearnerToTeacher(learner, teacherB)
    const pkg = await createDirectPackage(teacherA, 'unlinked-pkg')
    const cookieA = await teacherCookie(teacherA)

    const res = await teacherPackageIssuePost(
      buildRequest(`/api/teacher/packages/${pkg.id}/issue`, {
        cookie: cookieA,
        body: { learnerAccountId: learner },
      }),
      { params: Promise.resolve({ id: pkg.id }) },
    )
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toBe('learner_not_linked')
  })

  it('anti-spoof: teacher A cannot issue B\'s package (404 not_found, no ownership leak)', async () => {
    const teacherA = await makeTeacher(TEACHER_EMAIL_A)
    const teacherB = await makeTeacher(TEACHER_EMAIL_B)
    const learner = await makeLearner(LEARNER_EMAIL)
    await linkLearnerToTeacher(learner, teacherA)
    const pkgB = await createDirectPackage(teacherB, 'b-only-pkg')
    const cookieA = await teacherCookie(teacherA)

    const res = await teacherPackageIssuePost(
      buildRequest(`/api/teacher/packages/${pkgB.id}/issue`, {
        cookie: cookieA,
        body: { learnerAccountId: learner },
      }),
      { params: Promise.resolve({ id: pkgB.id }) },
    )
    expect(res.status).toBe(404)
  })

  it('admin override revoke works even when ownership check would fail', async () => {
    const teacherA = await makeTeacher(TEACHER_EMAIL_A)
    const admin = await makeAdmin()
    const learner = await makeLearner(LEARNER_EMAIL)
    await linkLearnerToTeacher(learner, teacherA)
    const pkg = await createDirectPackage(teacherA, 'admin-override-pkg')

    const cookieA = await teacherCookie(teacherA)
    const issueRes = await teacherPackageIssuePost(
      buildRequest(`/api/teacher/packages/${pkg.id}/issue`, {
        cookie: cookieA,
        body: { learnerAccountId: learner },
      }),
      { params: Promise.resolve({ id: pkg.id }) },
    )
    const { invoiceId } = await issueRes.json()

    const { cookieValue } = await createSession({ accountId: admin })
    const adminCookie = `${SESSION_COOKIE_NAME}=${cookieValue}`

    const overrideRes = await adminTeacherGrantRevokePost(
      buildRequest(`/api/admin/teacher-grant/${invoiceId}/revoke`, {
        cookie: adminCookie,
        body: {},
      }),
      { params: Promise.resolve({ id: invoiceId }) },
    )
    expect(overrideRes.status).toBe(200)

    const orderRow = await getDbPool().query(
      `select status from payment_orders where invoice_id = $1`,
      [invoiceId],
    )
    expect(orderRow.rows[0].status).toBe('teacher_revoked')
  })
})

describe('SAAS-PIVOT Day 4 — DB invariants', () => {
  it('quadruple-CHECK refuses provider=teacher_grant + payment_method=card', async () => {
    const teacherA = await makeTeacher(TEACHER_EMAIL_A)
    const learner = await makeLearner(LEARNER_EMAIL)
    await expect(
      getDbPool().query(
        `insert into payment_orders (
           invoice_id, amount_rub, currency, description,
           provider, status,
           created_at, updated_at, paid_at,
           customer_email, receipt_email,
           receipt, metadata,
           granted_by_teacher_id,
           payment_method
         ) values (
           'lc_tg_bad_check_001', 100, 'RUB', 'bad combo',
           'teacher_grant', 'teacher_granted',
           now(), now(), null,
           $1, $1,
           '{}'::jsonb, '{}'::jsonb,
           $2::uuid,
           'card'
         )`,
        [`bad-check-${Date.now()}@example.com`, teacherA],
      ),
    ).rejects.toThrow(/payment_orders_grant_consistency|payment_orders_payment_method_check/)
    void learner
  })

  it('mig 0076b: duplicate (teacher_id, slug) fails UNIQUE', async () => {
    const teacherA = await makeTeacher(TEACHER_EMAIL_A)
    await createDirectPackage(teacherA, 'dup-slug-pkg')
    await expect(
      createDirectPackage(teacherA, 'dup-slug-pkg'),
    ).rejects.toThrow(/lesson_packages_teacher_slug_unique|duplicate key/)
  })

  it('mig 0076b: same slug + different teacher succeeds', async () => {
    const teacherA = await makeTeacher(TEACHER_EMAIL_A)
    const teacherB = await makeTeacher(TEACHER_EMAIL_B)
    const a = await createDirectPackage(teacherA, 'shared-slug-pkg')
    const b = await createDirectPackage(teacherB, 'shared-slug-pkg')
    expect(a.id).not.toBe(b.id)
    expect(a.slug).toBe(b.slug)
  })
})

describe('SAAS-PIVOT Day 4 — refund route guard', () => {
  it('admin /refunds rejects teacher_grant orders with non_money_order_not_refundable', async () => {
    const teacherA = await makeTeacher(TEACHER_EMAIL_A)
    const admin = await makeAdmin()
    const learner = await makeLearner(LEARNER_EMAIL)
    await linkLearnerToTeacher(learner, teacherA)
    const pkg = await createDirectPackage(teacherA, 'refund-guard-pkg')
    const cookieA = await teacherCookie(teacherA)
    const issueRes = await teacherPackageIssuePost(
      buildRequest(`/api/teacher/packages/${pkg.id}/issue`, {
        cookie: cookieA,
        body: { learnerAccountId: learner },
      }),
      { params: Promise.resolve({ id: pkg.id }) },
    )
    const { invoiceId, purchaseId } = await issueRes.json()

    const { cookieValue } = await createSession({ accountId: admin })
    const adminCookie = `${SESSION_COOKIE_NAME}=${cookieValue}`

    const refundRes = await adminRefundsPost(
      buildRequest('/api/admin/refunds', {
        cookie: adminCookie,
        body: {
          paymentOrderId: invoiceId,
          kind: 'package',
          targetId: purchaseId,
          refundedKopecks: 100000,
        },
      }),
    )
    expect(refundRes.status).toBe(422)
    const body = await refundRes.json()
    expect(body.error).toBe('non_money_order_not_refundable')
    expect(body.provider).toBe('teacher_grant')
  })
})
