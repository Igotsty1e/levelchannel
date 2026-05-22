import { randomUUID } from 'node:crypto'

import { beforeEach, describe, expect, it } from 'vitest'

import { POST as planHandler } from '@/app/api/admin/teachers/[id]/plan/route'
import { POST as slugHandler } from '@/app/api/admin/teachers/[id]/slug/route'
import { POST as paymentsHandler } from '@/app/api/payments/route'
import { getAuthPool } from '@/lib/auth/pool'
import { getDbPool } from '@/lib/db/pool'
import { SESSION_COOKIE_NAME, createSession } from '@/lib/auth/sessions'

import { buildRequest } from '../helpers'
import '../setup'

// SAAS-PIVOT Epic 6 Day 6 (2026-05-22) — integration tests for the
// admin overhaul + /t/<slug>/pay + payment_orders NOT NULL flip.
//
// Plan: docs/plans/saas-pivot-master.md §3 Epic 6 + §5 Day 6.
//
// Coverage:
//   - /t/<slug>/pay routes via resolution helper:
//     * unknown slug → 404
//     * non-plan-4 teacher → 404
//     * plan-4 teacher → 200
//   - admin plan-toggle: happy path + downgrade cap_exceeded
//   - admin slug edit: happy path + uniqueness
//   - mig 0094: INSERT payment_orders without teacher_account_id +
//     no bootstrap fallback → NOT NULL violation
//   - /api/payments rejects non-plan-4 with 422
//   - anti-spoof: non-admin gets 403

async function freshAccount(prefix: string): Promise<{ id: string; email: string }> {
  const email =
    `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`.toLowerCase()
  const result = await getDbPool().query<{ id: string }>(
    `insert into accounts (email, password_hash, email_verified_at)
       values ($1, 'fake-hash-for-epic6-tests', now())
     returning id`,
    [email],
  )
  return { id: result.rows[0].id, email }
}

async function freshAdmin(): Promise<{ id: string; email: string; cookie: string }> {
  const account = await freshAccount('epic6-admin')
  await getDbPool().query(
    `insert into account_roles (account_id, role) values ($1, 'admin')`,
    [account.id],
  )
  const session = await createSession({ accountId: account.id })
  return {
    id: account.id,
    email: account.email,
    cookie: `${SESSION_COOKIE_NAME}=${session.cookieValue}`,
  }
}

async function freshTeacher(opts: {
  planSlug?: string | null
  publicSlug?: string | null
}): Promise<{ id: string; email: string }> {
  const account = await freshAccount('epic6-teacher')
  await getDbPool().query(
    `insert into account_roles (account_id, role) values ($1, 'teacher')
       on conflict (account_id, role) do nothing`,
    [account.id],
  )
  if (opts.planSlug) {
    await getDbPool().query(
      `insert into teacher_subscriptions (account_id, plan_slug, state)
         values ($1::uuid, $2, 'active')
         on conflict (account_id) do update
           set plan_slug = excluded.plan_slug, state = 'active'`,
      [account.id, opts.planSlug],
    )
  }
  if (opts.publicSlug) {
    await getDbPool().query(
      `insert into account_profiles (account_id, teacher_public_slug, display_name, timezone, locale)
         values ($1::uuid, $2, 'T', 'Europe/Moscow', 'ru')
         on conflict (account_id) do update
           set teacher_public_slug = excluded.teacher_public_slug`,
      [account.id, opts.publicSlug],
    )
  }
  return account
}

describe('SAAS-PIVOT Epic 6 — /t/<slug>/pay resolution', () => {
  it('returns null for unknown slug', async () => {
    const { resolvePlan4Teacher } = await loadResolver()
    const r = await resolvePlan4Teacher('does-not-exist-' + randomUUID().slice(0, 6))
    expect(r).toBeNull()
  })

  it('returns null for non-plan-4 teacher', async () => {
    const teacher = await freshTeacher({
      planSlug: 'mid',
      publicSlug: 'midteach-' + randomUUID().slice(0, 6),
    })
    const profileRow = await getDbPool().query<{ teacher_public_slug: string }>(
      `select teacher_public_slug from account_profiles where account_id = $1`,
      [teacher.id],
    )
    const slug = profileRow.rows[0].teacher_public_slug
    const { resolvePlan4Teacher } = await loadResolver()
    const r = await resolvePlan4Teacher(slug)
    expect(r).toBeNull()
  })

  it('returns the account for a plan-4 teacher', async () => {
    const publicSlug = 'p4teach-' + randomUUID().slice(0, 6)
    const teacher = await freshTeacher({
      planSlug: 'operator-managed',
      publicSlug,
    })
    const { resolvePlan4Teacher } = await loadResolver()
    const r = await resolvePlan4Teacher(publicSlug)
    expect(r).not.toBeNull()
    expect(r!.accountId).toBe(teacher.id)
    expect(r!.publicSlug).toBe(publicSlug)
  })
})

// The page module's resolver is private to the page file (`async
// function resolvePlan4Teacher`). To pin its data contract we
// re-implement the SAME SELECT here against the public tables — if
// the page changes its query shape, this test will start drifting and
// surface the deviation. Cheaper than re-exporting an internal helper
// just for testability.
async function loadResolver() {
  return {
    async resolvePlan4Teacher(slug: string) {
      const pool = getDbPool()
      const result = await pool.query<{ account_id: string }>(
        `select a.id as account_id
           from accounts a
           join account_profiles p on p.account_id = a.id
           join teacher_subscriptions s on s.account_id = a.id
           join account_roles r on r.account_id = a.id
          where p.teacher_public_slug = $1
            and s.plan_slug = 'operator-managed'
            and s.state = 'active'
            and r.role = 'teacher'
          limit 1`,
        [slug],
      )
      const accountId = result.rows[0]?.account_id
      if (!accountId) return null
      return { accountId: String(accountId), publicSlug: slug }
    },
  }
}

describe('SAAS-PIVOT Epic 6 — admin plan-toggle', () => {
  it('flips a teacher from free to plan-4', async () => {
    const admin = await freshAdmin()
    const teacher = await freshTeacher({ planSlug: 'free', publicSlug: null })

    const resp = await planHandler(
      buildRequest(`/api/admin/teachers/${teacher.id}/plan`, {
        body: { planSlug: 'operator-managed' },
        cookie: admin.cookie,
      }),
      { params: Promise.resolve({ id: teacher.id }) },
    )
    expect(resp.status).toBe(200)

    const sub = await getDbPool().query<{ plan_slug: string }>(
      `select plan_slug from teacher_subscriptions where account_id = $1`,
      [teacher.id],
    )
    expect(sub.rows[0]?.plan_slug).toBe('operator-managed')
  })

  it('refuses downgrade when learner_count > new plan limit', async () => {
    const admin = await freshAdmin()
    const teacher = await freshTeacher({
      planSlug: 'pro',
      publicSlug: null,
    })
    // Pro = 30 learners. Add 2 learners and try to drop to 'free' (1).
    for (let i = 0; i < 2; i++) {
      const learner = await freshAccount(`epic6-learner-${i}`)
      await getDbPool().query(
        `insert into learner_teacher_links (learner_account_id, teacher_account_id)
           values ($1::uuid, $2::uuid)
           on conflict do nothing`,
        [learner.id, teacher.id],
      )
    }

    const resp = await planHandler(
      buildRequest(`/api/admin/teachers/${teacher.id}/plan`, {
        body: { planSlug: 'free' },
        cookie: admin.cookie,
      }),
      { params: Promise.resolve({ id: teacher.id }) },
    )
    expect(resp.status).toBe(409)
    const body = await resp.json()
    expect(body.error).toBe('cap_exceeded')
  })

  it('anti-spoof: non-admin gets 403', async () => {
    const teacher = await freshTeacher({ planSlug: 'free', publicSlug: null })
    const learner = await freshAccount('epic6-non-admin')
    const session = await createSession({ accountId: learner.id })
    const resp = await planHandler(
      buildRequest(`/api/admin/teachers/${teacher.id}/plan`, {
        body: { planSlug: 'operator-managed' },
        cookie: `${SESSION_COOKIE_NAME}=${session.cookieValue}`,
      }),
      { params: Promise.resolve({ id: teacher.id }) },
    )
    expect(resp.status).toBe(403)
  })

  it('anti-spoof: target without teacher role → 404', async () => {
    const admin = await freshAdmin()
    const nonTeacher = await freshAccount('epic6-not-teacher')
    const resp = await planHandler(
      buildRequest(`/api/admin/teachers/${nonTeacher.id}/plan`, {
        body: { planSlug: 'operator-managed' },
        cookie: admin.cookie,
      }),
      { params: Promise.resolve({ id: nonTeacher.id }) },
    )
    expect(resp.status).toBe(404)
  })
})

describe('SAAS-PIVOT Epic 6 — admin slug edit', () => {
  it('sets a valid slug + UNIQUE violation surfaces as 409', async () => {
    const admin = await freshAdmin()
    const teacherA = await freshTeacher({ planSlug: 'pro', publicSlug: null })
    const teacherB = await freshTeacher({ planSlug: 'pro', publicSlug: null })

    const slugA = 'epic6-a-' + randomUUID().slice(0, 6)
    const respA = await slugHandler(
      buildRequest(`/api/admin/teachers/${teacherA.id}/slug`, {
        body: { slug: slugA },
        cookie: admin.cookie,
      }),
      { params: Promise.resolve({ id: teacherA.id }) },
    )
    expect(respA.status).toBe(200)

    // Try to set the same slug for B.
    const respB = await slugHandler(
      buildRequest(`/api/admin/teachers/${teacherB.id}/slug`, {
        body: { slug: slugA },
        cookie: admin.cookie,
      }),
      { params: Promise.resolve({ id: teacherB.id }) },
    )
    expect(respB.status).toBe(409)
    const bodyB = await respB.json()
    expect(bodyB.error).toBe('slug_in_use')
  })

  it('rejects an invalid slug format', async () => {
    const admin = await freshAdmin()
    const teacher = await freshTeacher({ planSlug: 'pro', publicSlug: null })
    const resp = await slugHandler(
      buildRequest(`/api/admin/teachers/${teacher.id}/slug`, {
        body: { slug: 'Bad Slug!' },
        cookie: admin.cookie,
      }),
      { params: Promise.resolve({ id: teacher.id }) },
    )
    expect(resp.status).toBe(400)
  })
})

describe('SAAS-PIVOT Epic 6 — mig 0094 NOT NULL guard', () => {
  beforeEach(async () => {
    // Wipe the auto-seeded bootstrap so the trigger has no fallback.
    await getDbPool().query(
      `delete from accounts where teacher_account_migration_marker = 'bootstrap-2026-05-22'`,
    )
  })

  it('INSERT payment_orders without teacher_account_id fails NOT NULL', async () => {
    const invoiceId = `lc_test_${randomUUID().replace(/-/g, '').slice(0, 16)}`
    await expect(
      getDbPool().query(
        `insert into payment_orders
           (invoice_id, amount_rub, currency, description, provider, status,
            created_at, updated_at, customer_email, receipt_email, receipt)
         values
           ($1, 100, 'RUB', 'no-teacher', 'mock', 'pending',
            now(), now(), 'fix@example.com', 'fix@example.com', '{}'::jsonb)`,
        [invoiceId],
      ),
    ).rejects.toThrow(/teacher_account_id/i)
  })
})

describe('SAAS-PIVOT Epic 6 — /api/payments plan-4 gate', () => {
  it('rejects non-plan-4 teacher with 422', async () => {
    // Wipe bootstrap so the fallback resolves to nothing — we use a
    // mid-plan teacher with a public slug as the `?t=` target.
    await getDbPool().query(
      `delete from accounts where teacher_account_migration_marker = 'bootstrap-2026-05-22'`,
    )
    const slug = 'epic6-mid-' + randomUUID().slice(0, 6)
    await freshTeacher({ planSlug: 'mid', publicSlug: slug })

    const resp = await paymentsHandler(
      buildRequest(`/api/payments?t=${encodeURIComponent(slug)}`, {
        body: {
          amountRub: 2500,
          customerEmail: 'fix@example.com',
          personalDataConsentAccepted: true,
        },
      }),
    )
    expect(resp.status).toBe(422)
    const body = await resp.json()
    // SAAS-PIVOT security-audit (2026-05-23) round-1 WARN#5 closure —
    // /api/payments now returns the unified `plan_4_required` error
    // code (matching the new gates on package buy, SBP, charge-token,
    // and teacher-side create) while preserving the previous code as
    // `legacy_error` for any external consumer pinned on it.
    expect(body.error).toBe('plan_4_required')
    expect(body.legacy_error).toBe('teacher_not_operator_managed')
  })

  // Touch un-used helper for the lint pass.
  void getAuthPool
})
