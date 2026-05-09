import { afterAll, afterEach, beforeAll } from 'vitest'

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
  await pool.query(`
    truncate table
      account_consents,
      account_sessions,
      email_verifications,
      password_resets,
      account_roles,
      lesson_slots,
      accounts,
      pricing_tariffs
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
  // Reset in-memory and Postgres rate-limit buckets so per-IP and
  // per-email-hash counters don't leak across test cases.
  await __resetRateLimitsForTesting()
})

afterAll(async () => {
  await getAuthPool().end()
})
