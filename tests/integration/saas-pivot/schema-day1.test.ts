import { randomUUID } from 'node:crypto'

import { beforeEach, describe, expect, it } from 'vitest'

import { getDbPool } from '@/lib/db/pool'

import '../setup'

// SAAS-PIVOT Epic 6 Day 6 (2026-05-22) — the integration setup
// auto-seeds a bootstrap teacher (so /api/payments writers have a
// fallback). This test file owns the bootstrap-existence invariants
// directly (mig 0083 idempotency, no-bootstrap-on-fresh-DB), so we
// wipe the auto-seeded marker before each test in this file.
beforeEach(async () => {
  await getDbPool().query(
    `delete from accounts where teacher_account_migration_marker = 'bootstrap-2026-05-22'`,
  )
})

// SAAS-PIVOT Epic 1 Day 1 schema invariants.
//
// Plan: docs/plans/saas-pivot-master.md §2.1 + §2.7 + §2.9 + §5 Day 1.
//
// Pins the load-bearing CHECK constraints and the Day-1-vs-deferred
// nullability contract for every migration in the Day-1 set:
//   0073 — teacher_subscription_plans (4 canonical slugs)
//   0074 — teacher_subscriptions (state enum)
//   0075 — pricing_tariffs.teacher_id NULLABLE on Day 1
//   0076a — lesson_packages.teacher_id NULLABLE on Day 1
//   0076c — package_purchases.teacher_id NULLABLE on Day 1
//   0077 — learner_teacher_links PK
//   0081 — teacher_earnings sign-invariant
//   0086 — account_profiles.teacher_public_slug UNIQUE + regex
//   0083 — bootstrap row-MOVE marker
//   0085 — payment_orders.teacher_account_id NULLABLE on Day 1

async function freshAccount(prefix: string): Promise<{ id: string; email: string }> {
  // accounts_email_normalized CHECK requires email = lower(btrim(email)).
  // Lowercase the whole composed email so a prefix like 'multi-teacherA'
  // doesn't break the constraint.
  const email =
    `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`.toLowerCase()
  const result = await getDbPool().query<{ id: string }>(
    `insert into accounts (email, password_hash)
     values ($1, 'fake-hash-for-schema-tests')
     returning id`,
    [email],
  )
  return { id: result.rows[0].id, email }
}

async function freshAdmin(prefix: string): Promise<{ id: string; email: string }> {
  const account = await freshAccount(prefix)
  await getDbPool().query(
    `insert into account_roles (account_id, role) values ($1, 'admin')
     on conflict (account_id, role) do nothing`,
    [account.id],
  )
  return account
}

describe('SAAS-PIVOT Day 1 — teacher_subscription_plans (mig 0073)', () => {
  it('has exactly the 4 canonical slugs after re-seed', async () => {
    const result = await getDbPool().query<{ slug: string }>(
      `select slug from teacher_subscription_plans order by slug`,
    )
    const slugs = result.rows.map((r) => r.slug)
    expect(slugs).toEqual(['free', 'mid', 'operator-managed', 'pro'])
  })

  it('canonical operator slug is "operator-managed" NOT "operator"', async () => {
    const operatorRow = await getDbPool().query<{ slug: string }>(
      `select slug from teacher_subscription_plans where slug = 'operator'`,
    )
    expect(operatorRow.rowCount).toBe(0)

    const managedRow = await getDbPool().query<{ slug: string }>(
      `select slug from teacher_subscription_plans where slug = 'operator-managed'`,
    )
    expect(managedRow.rowCount).toBe(1)
  })

  it('rejects an unknown slug via slug_format CHECK', async () => {
    await expect(
      getDbPool().query(
        `insert into teacher_subscription_plans (slug, title_ru, price_kopecks_monthly)
         values ('BadSlug!', 'X', 0)`,
      ),
    ).rejects.toThrow(/teacher_subscription_plans_slug_format/)
  })
})

describe('SAAS-PIVOT Day 1 — teacher_subscriptions (mig 0074)', () => {
  it('rejects state values outside the enum', async () => {
    const teacher = await freshAccount('tsub-bad-state')
    await expect(
      getDbPool().query(
        `insert into teacher_subscriptions (account_id, plan_slug, state)
         values ($1, 'free', 'unknown_state')`,
        [teacher.id],
      ),
    ).rejects.toThrow(/teacher_subscriptions_state_check/)
  })

  it('rejects unknown plan_slug via FK', async () => {
    const teacher = await freshAccount('tsub-bad-plan')
    await expect(
      getDbPool().query(
        `insert into teacher_subscriptions (account_id, plan_slug)
         values ($1, 'enterprise')`,
        [teacher.id],
      ),
    ).rejects.toThrow(/teacher_subscriptions_plan_slug_fkey/)
  })

  it('accepts the four canonical states', async () => {
    for (const state of ['active', 'past_due', 'cancelled', 'suspended']) {
      const teacher = await freshAccount(`tsub-${state}`)
      await getDbPool().query(
        `insert into teacher_subscriptions (account_id, plan_slug, state)
         values ($1, 'free', $2)`,
        [teacher.id, state],
      )
    }
  })
})

describe('SAAS-PIVOT Day 1 — pricing_tariffs.teacher_id + deleted_at (mig 0075/0088)', () => {
  // SAAS-PIVOT Epic 2 Day 3 (mig 0088) flipped pricing_tariffs.teacher_id
  // to NOT NULL. The Day-1 "insert-without-teacher-id-succeeds" claim is
  // historical — replaced by the NOT NULL assertion that lives in the
  // teacher-tariffs.test.ts suite alongside the writer tests.
  it('teacher_id is NOT NULL after mig 0088, deleted_at remains nullable', async () => {
    const result = await getDbPool().query<{ column_name: string; is_nullable: string }>(
      `select column_name, is_nullable
         from information_schema.columns
        where table_name = 'pricing_tariffs'
          and column_name in ('teacher_id', 'deleted_at')
        order by column_name`,
    )
    expect(result.rows).toEqual([
      { column_name: 'deleted_at', is_nullable: 'YES' },
      { column_name: 'teacher_id', is_nullable: 'NO' },
    ])
  })
})

describe('SAAS-PIVOT Day 4 — lesson_packages.teacher_id NOT NULL (mig 0089)', () => {
  // SAAS-PIVOT Epic 3 Day 4 (mig 0089) flipped lesson_packages.teacher_id
  // to NOT NULL alongside the global-slug → composite-(teacher_id,slug)
  // UNIQUE swap. The Day-1 "insert-without-teacher-id-succeeds" claim is
  // historical; replaced by the NOT NULL assertion.
  it('mig 0089: column is NOT NULL', async () => {
    const result = await getDbPool().query<{ is_nullable: string }>(
      `select is_nullable from information_schema.columns
        where table_name = 'lesson_packages' and column_name = 'teacher_id'`,
    )
    expect(result.rows).toEqual([{ is_nullable: 'NO' }])
  })

  it('mig 0089: INSERT without teacher_id fails NOT NULL', async () => {
    await expect(
      getDbPool().query(
        `insert into lesson_packages (slug, title_ru, duration_minutes, count, amount_kopecks)
         values ('day4-pkg-' || floor(random() * 1e9)::text, 'Day-4 pkg', 60, 5, 7500)`,
      ),
    ).rejects.toThrow(/teacher_id|null value|23502/i)
  })
})

describe('SAAS-PIVOT Day 4 — package_purchases.teacher_id NOT NULL (mig 0089)', () => {
  // SAAS-PIVOT Epic 3 Day 4 (mig 0089) flipped package_purchases.teacher_id
  // to NOT NULL together with the lesson_packages flip (one TX). The Day-1
  // "nullable" claim is historical; replaced by NOT NULL assertion.
  it('mig 0089: column is NOT NULL', async () => {
    const result = await getDbPool().query<{ is_nullable: string }>(
      `select is_nullable from information_schema.columns
        where table_name = 'package_purchases' and column_name = 'teacher_id'`,
    )
    expect(result.rows).toEqual([{ is_nullable: 'NO' }])
  })
})

describe('SAAS-PIVOT Day 1 — learner_teacher_links (mig 0077)', () => {
  it('rejects duplicate (learner, teacher) pair via PK', async () => {
    const learner = await freshAccount('ltl-learner')
    const teacher = await freshAccount('ltl-teacher')
    await getDbPool().query(
      `insert into learner_teacher_links (learner_account_id, teacher_account_id)
       values ($1, $2)`,
      [learner.id, teacher.id],
    )
    await expect(
      getDbPool().query(
        `insert into learner_teacher_links (learner_account_id, teacher_account_id)
         values ($1, $2)`,
        [learner.id, teacher.id],
      ),
    ).rejects.toThrow(/learner_teacher_links_pkey|duplicate key/)
  })

  it('allows a learner to have multiple distinct teachers', async () => {
    const learner = await freshAccount('ltl-multi-learner')
    const teacherA = await freshAccount('ltl-multi-teacherA')
    const teacherB = await freshAccount('ltl-multi-teacherB')
    await getDbPool().query(
      `insert into learner_teacher_links (learner_account_id, teacher_account_id)
       values ($1, $2), ($1, $3)`,
      [learner.id, teacherA.id, teacherB.id],
    )
    const result = await getDbPool().query<{ count: string }>(
      `select count(*) from learner_teacher_links where learner_account_id = $1`,
      [learner.id],
    )
    expect(Number(result.rows[0].count)).toBe(2)
  })
})

describe('SAAS-PIVOT Day 1 — teacher_earnings sign-invariant (mig 0081)', () => {
  it('rejects accrued with negative amount_net', async () => {
    const teacher = await freshAccount('te-bad-accrued')
    await expect(
      getDbPool().query(
        `insert into teacher_earnings (teacher_account_id, kind, amount_net)
         values ($1, 'accrued', -100.00)`,
        [teacher.id],
      ),
    ).rejects.toThrow(/teacher_earnings_sign_invariant/)
  })

  it('rejects paid_out with positive amount_net', async () => {
    const teacher = await freshAccount('te-bad-paid-out')
    await expect(
      getDbPool().query(
        `insert into teacher_earnings (teacher_account_id, kind, amount_net)
         values ($1, 'paid_out', 100.00)`,
        [teacher.id],
      ),
    ).rejects.toThrow(/teacher_earnings_sign_invariant/)
  })

  it('rejects clawback with positive amount_net', async () => {
    const teacher = await freshAccount('te-bad-clawback')
    await expect(
      getDbPool().query(
        `insert into teacher_earnings (teacher_account_id, kind, amount_net)
         values ($1, 'clawback', 50.00)`,
        [teacher.id],
      ),
    ).rejects.toThrow(/teacher_earnings_sign_invariant/)
  })

  it('accepts accrued + paid_out + clawback rows with the correct signs', async () => {
    const teacher = await freshAccount('te-ok')
    const result = await getDbPool().query<{ id: string }>(
      `insert into teacher_earnings (teacher_account_id, kind, amount_net)
       values ($1, 'accrued', 500.00),
              ($1, 'paid_out', -200.00),
              ($1, 'clawback', -50.00)
       returning id`,
      [teacher.id],
    )
    expect(result.rowCount).toBe(3)

    const balanceResult = await getDbPool().query<{ balance: string }>(
      `select coalesce(sum(amount_net), 0)::text as balance
         from teacher_earnings
        where teacher_account_id = $1`,
      [teacher.id],
    )
    expect(Number(balanceResult.rows[0].balance)).toBe(250)
  })

  it('rejects unknown kind via CHECK', async () => {
    const teacher = await freshAccount('te-bad-kind')
    await expect(
      getDbPool().query(
        `insert into teacher_earnings (teacher_account_id, kind, amount_net)
         values ($1, 'invented_kind', 100.00)`,
        [teacher.id],
      ),
    ).rejects.toThrow(/teacher_earnings_kind_check/)
  })
})

describe('SAAS-PIVOT Day 1 — account_profiles.teacher_public_slug (mig 0086)', () => {
  it('rejects malformed slug "BadSlug!" via allowlist CHECK', async () => {
    const teacher = await freshAccount('aps-bad-slug')
    await expect(
      getDbPool().query(
        `insert into account_profiles (account_id, teacher_public_slug)
         values ($1, 'BadSlug!')`,
        [teacher.id],
      ),
    ).rejects.toThrow(/account_profiles_teacher_public_slug_format/)
  })

  it('rejects too-short slug "xy" via min-length CHECK', async () => {
    const teacher = await freshAccount('aps-short')
    await expect(
      getDbPool().query(
        `insert into account_profiles (account_id, teacher_public_slug)
         values ($1, 'xy')`,
        [teacher.id],
      ),
    ).rejects.toThrow(/account_profiles_teacher_public_slug_format/)
  })

  it('rejects duplicate slug via UNIQUE partial index', async () => {
    const teacherA = await freshAccount('aps-dup-A')
    const teacherB = await freshAccount('aps-dup-B')
    const slug = `dup-${randomUUID().slice(0, 8)}`
    await getDbPool().query(
      `insert into account_profiles (account_id, teacher_public_slug)
       values ($1, $2)`,
      [teacherA.id, slug],
    )
    await expect(
      getDbPool().query(
        `insert into account_profiles (account_id, teacher_public_slug)
         values ($1, $2)`,
        [teacherB.id, slug],
      ),
    ).rejects.toThrow(/account_profiles_teacher_public_slug_unique|duplicate key/)
  })

  it('accepts a valid slug pattern', async () => {
    const teacher = await freshAccount('aps-ok')
    const slug = `ok-${randomUUID().slice(0, 8)}`
    await getDbPool().query(
      `insert into account_profiles (account_id, teacher_public_slug)
       values ($1, $2)`,
      [teacher.id, slug],
    )
    const row = await getDbPool().query<{ teacher_public_slug: string | null }>(
      `select teacher_public_slug from account_profiles where account_id = $1`,
      [teacher.id],
    )
    expect(row.rows[0].teacher_public_slug).toBe(slug)
  })
})

describe('SAAS-PIVOT Day 6 — payment_orders.teacher_account_id NOT NULL (mig 0094)', () => {
  // SAAS-PIVOT Epic 6 Day 6 (mig 0094) flipped teacher_account_id to
  // NOT NULL after the Day-6 writer sweep. Day-1 "insert-without-id-succeeds"
  // claim is historical; replaced by NOT NULL assertion.
  it('mig 0094: INSERT without teacher_account_id fails NOT NULL', async () => {
    const invoiceId = `lc_day6_${randomUUID().replace(/-/g, '').slice(0, 16)}`
    await expect(
      getDbPool().query(
        `insert into payment_orders (
           invoice_id, amount_rub, currency, description, provider, status,
           created_at, updated_at, customer_email, receipt_email, receipt
         ) values (
           $1, 100, 'RUB', 'day-6 schema test', 'cloudpayments', 'pending',
           now(), now(), 'day6@example.com', 'day6@example.com', '{}'::jsonb
         )`,
        [invoiceId],
      ),
    ).rejects.toThrow(/teacher_account_id|null value|23502/i)
  })

  it('accepts an explicit teacher_account_id', async () => {
    const teacher = await freshAccount('po-with-teacher')
    const invoiceId = `lc_day1_${randomUUID().replace(/-/g, '').slice(0, 16)}`
    await getDbPool().query(
      `insert into payment_orders (
         invoice_id, amount_rub, currency, description, provider, status,
         created_at, updated_at, customer_email, receipt_email, receipt,
         teacher_account_id
       ) values (
         $1, 100, 'RUB', 'day-1 schema test', 'cloudpayments', 'pending',
         now(), now(), 'day1@example.com', 'day1@example.com', '{}'::jsonb,
         $2::uuid
       )`,
      [invoiceId, teacher.id],
    )
    const row = await getDbPool().query<{ teacher_account_id: string | null }>(
      `select teacher_account_id from payment_orders where invoice_id = $1`,
      [invoiceId],
    )
    expect(row.rows[0].teacher_account_id).toBe(teacher.id)
  })
})

describe('SAAS-PIVOT Day 1 — bootstrap row-MOVE marker (mig 0083)', () => {
  it('audit_email_history + teacher_account_migration_marker columns exist on accounts', async () => {
    const result = await getDbPool().query<{ column_name: string; is_nullable: string }>(
      `select column_name, is_nullable
         from information_schema.columns
        where table_name = 'accounts'
          and column_name in ('audit_email_history', 'teacher_account_migration_marker')
        order by column_name`,
    )
    expect(result.rows.map((r) => r.column_name)).toEqual([
      'audit_email_history',
      'teacher_account_migration_marker',
    ])
  })

  it('runs end-to-end on a seeded admin: mints NEW teacher with marker + public slug + plan-4 sub', async () => {
    // Seed an admin so mig 0083's idempotency guard treats the test
    // DB like a "fresh prod" — exactly one admin → row-MOVE executes.
    // afterEach TRUNCATEs everything so this is fully isolated.
    const oldEmail = `bootstrap-old-${Date.now()}@example.com`
    const oldAdmin = await getDbPool().query<{ id: string }>(
      `insert into accounts (email, password_hash, email_verified_at)
       values ($1, 'hash-bootstrap-test', now())
       returning id`,
      [oldEmail],
    )
    const oldId = oldAdmin.rows[0].id
    await getDbPool().query(
      `insert into account_roles (account_id, role) values ($1, 'admin')`,
      [oldId],
    )
    await getDbPool().query(
      `insert into account_profiles (account_id, display_name, timezone, locale)
       values ($1, 'OldAdmin', 'Europe/Moscow', 'ru')`,
      [oldId],
    )

    // Re-execute mig 0083's DO block. The migration file is idempotent
    // (re-run is no-op if marker present); we directly run the SQL
    // body so this test exercises it without re-applying via the
    // migrate runner (the runner already applied at test bootstrap;
    // re-running now after the TRUNCATE+seed lets us verify behaviour).
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    const url = await import('node:url')
    const here = url.fileURLToPath(import.meta.url)
    const repoRoot = path.resolve(path.dirname(here), '..', '..', '..')
    const migPath = path.join(repoRoot, 'migrations', '0083_bootstrap_teacher_account.sql')
    const sql = await fs.readFile(migPath, 'utf8')
    await getDbPool().query(sql)

    // NEW account exists with marker + plan-4 + teacher_public_slug='level'.
    const newRow = await getDbPool().query<{
      id: string
      email: string
      email_verified_at: string | null
    }>(
      `select id, email, email_verified_at
         from accounts
        where teacher_account_migration_marker = 'bootstrap-2026-05-22'`,
    )
    expect(newRow.rowCount).toBe(1)
    expect(newRow.rows[0].email).toBe(oldEmail)
    expect(newRow.rows[0].email_verified_at).not.toBeNull()
    const newId = newRow.rows[0].id
    expect(newId).not.toBe(oldId)

    // NEW has a teacher role grant.
    const role = await getDbPool().query<{ role: string }>(
      `select role from account_roles where account_id = $1`,
      [newId],
    )
    expect(role.rows.map((r) => r.role)).toContain('teacher')

    // NEW has a plan-4 subscription.
    const sub = await getDbPool().query<{ plan_slug: string; state: string }>(
      `select plan_slug, state from teacher_subscriptions where account_id = $1`,
      [newId],
    )
    expect(sub.rows).toEqual([{ plan_slug: 'operator-managed', state: 'active' }])

    // NEW carries teacher_public_slug='level'.
    const slug = await getDbPool().query<{ teacher_public_slug: string | null }>(
      `select teacher_public_slug from account_profiles where account_id = $1`,
      [newId],
    )
    expect(slug.rows[0].teacher_public_slug).toBe('level')

    // OLD's email is renamed; audit_email_history records the swap.
    const oldNow = await getDbPool().query<{ email: string; audit_email_history: unknown }>(
      `select email, audit_email_history from accounts where id = $1`,
      [oldId],
    )
    expect(oldNow.rows[0].email).toBe('admin-2026-05-22@levelchannel.internal')
    const history = oldNow.rows[0].audit_email_history as Array<{ previous_email: string }>
    expect(history.length).toBeGreaterThanOrEqual(1)
    expect(history[0].previous_email).toBe(oldEmail)

    // Re-running mig 0083 is a no-op (idempotency).
    await getDbPool().query(sql)
    const stillOne = await getDbPool().query<{ c: string }>(
      `select count(*)::text as c from accounts
        where teacher_account_migration_marker = 'bootstrap-2026-05-22'`,
    )
    expect(Number(stillOne.rows[0].c)).toBe(1)
  })

  it('mig 0083 is a no-op on a DB with no admins (fresh test DB)', async () => {
    // No admin seeded — re-running mig 0083 should not mint anything.
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    const url = await import('node:url')
    const here = url.fileURLToPath(import.meta.url)
    const repoRoot = path.resolve(path.dirname(here), '..', '..', '..')
    const migPath = path.join(repoRoot, 'migrations', '0083_bootstrap_teacher_account.sql')
    const sql = await fs.readFile(migPath, 'utf8')
    await getDbPool().query(sql)
    const markerRows = await getDbPool().query<{ c: string }>(
      `select count(*)::text as c from accounts
        where teacher_account_migration_marker = 'bootstrap-2026-05-22'`,
    )
    expect(Number(markerRows.rows[0].c)).toBe(0)
  })

  // Silences the unused-import linter when the admin helper isn't
  // referenced by any case in this describe block.
  void freshAdmin
})
