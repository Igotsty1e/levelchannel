import { afterAll, afterEach, beforeAll } from 'vitest'

import { __resetBootstrapTeacherCacheForTesting } from '@/lib/auth/bootstrap-teacher'
import { getAuthPool } from '@/lib/auth/pool'
import { __resetRateLimitsForTesting } from '@/lib/security/rate-limit'

// Per /plan-eng-review D5 — integration tests run against Docker Postgres
// (postgres:16.13, exact prod parity). Brought up by scripts/test-integration.sh
// which sets DATABASE_URL pointing at 127.0.0.1:54329 + runs migrate:up.

beforeAll(async () => {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      'DATABASE_URL must be set for integration tests. Run via npm run test:integration.',
    )
  }
  // Touch the pool to fail fast if Docker is down.
  await getAuthPool().query('select 1')
})

afterEach(async () => {
  // Truncate all auth-domain tables in dependency order. Payment domain
  // is intentionally left alone — these tests don't touch it.
  const pool = getAuthPool()
  // accounts CASCADE removes account_profiles automatically (FK on
  // delete cascade), so it's not listed explicitly. pricing_tariffs is
  // domain-orthogonal but small; truncating it here keeps cabinet
  // integration cases independent.
  // SAAS-PIVOT Day 1 (2026-05-22) fixture sweep — round-25 BLOCKER #2
  // closure: add ONLY Day-1 tables here. `lesson_completions`,
  // `lesson_settlements`, `lesson_settlement_completions` are deferred
  // to Day 5A (Epic 5) — adding them now would fail TRUNCATE on tables
  // that don't yet exist. Order respects FKs: child tables before
  // parents (CASCADE handles incidental edges).
  await pool.query(`
    truncate table
      account_consents,
      account_sessions,
      email_verifications,
      password_resets,
      account_roles,
      package_consumptions,
      package_purchases,
      lesson_packages,
      payment_allocations,
      payment_orders,
      lesson_slots,
      learner_teacher_links,
      teacher_invites,
      teacher_subscriptions,
      teacher_earnings_payout_coverage,
      teacher_earnings,
      account_profiles,
      accounts,
      pricing_tariffs,
      teacher_subscription_plans
    restart identity cascade
  `)
  // legal-versioning sister wave: TRUNCATE CASCADE follows the FK
  // from legal_document_versions.created_by_account_id → accounts and
  // wipes the migration-installed v1 seed rows. Re-seed them so the
  // next test sees the same baseline as a fresh migration.
  await pool.query(`
    insert into legal_document_versions (doc_kind, version_label, effective_from, body_md)
    values
      ('offer', 'v1', now(),
       '# Публичная оферта (v1)' || E'\n\n' ||
       '_Полный текст: см. https://levelchannel.ru/offer на момент эффективной даты._' || E'\n\n' ||
       '_Эта запись является эвиденс-якорем для согласий, оформленных до запуска UI управления версиями._'),
      ('privacy', 'v1', now(),
       '# Политика обработки персональных данных (v1)' || E'\n\n' ||
       '_Полный текст: см. https://levelchannel.ru/privacy на момент эффективной даты._'),
      ('personal_data', 'v1', now(),
       '# Согласие на обработку персональных данных (v1)' || E'\n\n' ||
       '_Полный текст: см. https://levelchannel.ru/consent/personal-data на момент эффективной даты._')
    on conflict (doc_kind, version_label) do nothing
  `)
  // SAAS-PIVOT Day 1 (2026-05-22) — re-seed teacher_subscription_plans
  // baseline rows (mig 0073 INSERTs four canonical slugs; TRUNCATE
  // above wipes them between tests). Same pattern as the legal
  // re-seed above. Tests that need a teacher with a Mid/Pro/Free/Plan-4
  // subscription depend on this baseline.
  await pool.query(`
    insert into teacher_subscription_plans (slug, title_ru, price_kopecks_monthly, learner_limit, features)
    values
      ('free', 'Free', 0, 1, '{}'::jsonb),
      ('mid', 'Mid', 30000, 5, '{}'::jsonb),
      ('pro', 'Pro', 80000, 30, '{}'::jsonb),
      ('operator-managed', 'Operator-managed', 0, null, '{"money_flow_through_platform": true}'::jsonb)
    on conflict (slug) do nothing
  `)
  // Reset in-memory and Postgres rate-limit buckets so per-IP and
  // per-email-hash counters don't leak across test cases.
  await __resetRateLimitsForTesting()
  // SAAS-PIVOT Epic 2 Day 3 — drop the bootstrap-teacher cache so a
  // per-test seeded marker row is observable immediately (otherwise
  // the 30-second TTL would serve stale `null` from a previous test).
  __resetBootstrapTeacherCacheForTesting()
})

afterAll(async () => {
  await getAuthPool().end()
})
