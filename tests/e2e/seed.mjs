#!/usr/bin/env node
// Seed script for Playwright authenticated e2e suite.
//
// Connects to DATABASE_URL, wipes existing e2e fixtures, creates:
//   - learner account (student role, verified email)
//   - teacher account (teacher role, verified email)
//   - admin account (admin role, verified email)
//
// Mints a session for each via the same cookie + sha256-hash contract as
// `lib/auth/sessions.ts:createSession`. Writes `tests/e2e/.fixtures.json`
// with each role's `{email, accountId, cookieValue}` for the spec to read.
//
// Usage:
//   DATABASE_URL=postgres://... node tests/e2e/seed.mjs
//
// Idempotent: re-running clears the previous e2e fixture rows (matched by
// email prefix `e2e-fixture-`) before reseeding.

import { createHash, randomBytes } from 'node:crypto'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const { Pool } = pg

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURE_FILE = resolve(HERE, '.fixtures.json')

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.error('FAIL  DATABASE_URL not set')
  process.exit(2)
}

// Match `lib/auth/tokens.ts` mintToken / hashToken contract exactly.
function mintToken() {
  // lib/auth/tokens.ts uses 32 bytes; base64url encoding.
  const plain = randomBytes(32).toString('base64url')
  const hash = createHash('sha256').update(plain, 'utf8').digest('hex')
  return { plain, hash }
}

// SESSION_TTL_MS = 7 days per lib/auth/sessions.ts
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000

const ROLE_SPECS = [
  { role: 'learner', dbRole: 'student', email: 'e2e-fixture-learner@example.com' },
  { role: 'teacher', dbRole: 'teacher', email: 'e2e-fixture-teacher@example.com' },
  { role: 'admin', dbRole: 'admin', email: 'e2e-fixture-admin@example.com' },
]

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL })
  const out = {}

  try {
    // Clean slate.
    await pool.query(
      `delete from accounts where email like 'e2e-fixture-%@example.com'`,
    )

    for (const spec of ROLE_SPECS) {
      const accountInsert = await pool.query(
        `insert into accounts (email, password_hash, email_verified_at)
         values ($1, 'dummy-not-usable-for-login', now())
         returning id`,
        [spec.email],
      )
      const accountId = String(accountInsert.rows[0].id)

      await pool.query(
        `insert into account_roles (account_id, role) values ($1, $2)`,
        [accountId, spec.dbRole],
      )

      const { plain, hash } = mintToken()
      const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString()
      await pool.query(
        `insert into account_sessions (account_id, token_hash, expires_at)
         values ($1, $2, $3)`,
        [accountId, hash, expiresAt],
      )

      out[spec.role] = {
        accountId,
        email: spec.email,
        cookieValue: plain,
        expiresAt,
      }
      console.log(`  seeded ${spec.role}  accountId=${accountId}`)
    }

    // 2026-06-18 business-flow extension:
    // Привязываем учника к учителю через learner_teacher_links
    // (legacy accounts.assigned_teacher_id больше не используется
    // booking flow'ом — см. lib/auth/teacher-scope.ts).
    await pool.query(
      `insert into learner_teacher_links
         (learner_account_id, teacher_account_id, linked_at)
       values ($1, $2, now())
       on conflict do nothing`,
      [out.learner.accountId, out.teacher.accountId],
    )
    console.log(`  linked learner → teacher (learner_teacher_links)`)

    await pool.query(
      `insert into teacher_payment_methods
         (teacher_account_id, phone_e164, phone_display, bank_label, is_default)
       values ($1, '+79001234567', '+7 (900) 123-45-67', 'Сбербанк (e2e fixture)', true)
       on conflict do nothing`,
      [out.teacher.accountId],
    )
    console.log(`  created teacher payment method (SBP default)`)

    // pricing_tariff + learner_tariff_access — без них слот не может
    // быть забронирован (booking.ts:310 → tariff_required, 402).
    // duration_minutes — required (mig 0046, no default).
    // teacher_id — required (mig 0088 NOT NULL after multi-tenant epic).
    const tariffInsert = await pool.query(
      `insert into pricing_tariffs
         (slug, title_ru, amount_kopecks, duration_minutes, is_active, teacher_id)
       values ('e2e-fixture-individual', 'Индивидуальное (e2e fixture)', 150000, 60, true, $1)
       on conflict (slug) do update set is_active = excluded.is_active
       returning id`,
      [out.teacher.accountId],
    )
    const tariffId = String(tariffInsert.rows[0].id)
    out.tariffId = tariffId
    console.log(`  upserted fixture tariff ${tariffId}`)

    await pool.query(
      `insert into learner_tariff_access
         (teacher_id, learner_account_id, tariff_id, granted_at)
       values ($1, $2, $3, now())
       on conflict do nothing`,
      [out.teacher.accountId, out.learner.accountId, tariffId],
    )
    console.log(`  granted learner tariff access`)

    // Создаём 3 слота. Все в MSK business hours (07:00-15:00 UTC =
    // 10:00-18:00 MSK), seconds=0 (mig 0125).
    // slot[0] — БУДУЩИЙ open (для BOOK-1: книгует через API).
    // slot[1] — ПРОШЛЫЙ booked учнем (для BOOK-2: mark-completed).
    // slot[2] — ПРОШЛЫЙ booked учнем (для BOOK-3: payment-context + claim).
    const slotIds = []
    const specs = [
      {
        daysFromNow: 2,
        hourUtc: 7,
        status: 'open',
        learnerAccountId: null,
      },
      {
        daysFromNow: -3,
        hourUtc: 8,
        status: 'booked',
        learnerAccountId: out.learner.accountId,
      },
      {
        daysFromNow: -2,
        hourUtc: 9,
        status: 'booked',
        learnerAccountId: out.learner.accountId,
      },
    ]
    for (const spec of specs) {
      const day = new Date(Date.now() + spec.daysFromNow * 24 * 60 * 60 * 1000)
      day.setUTCHours(spec.hourUtc, 0, 0, 0)
      const slotInsert = await pool.query(
        `insert into lesson_slots
           (teacher_account_id, start_at, duration_minutes, status,
            snapshot_amount_kopecks, tariff_id, learner_account_id)
         values ($1, $2, 60, $3, 150000, $4, $5)
         returning id`,
        [
          out.teacher.accountId,
          day.toISOString(),
          spec.status,
          tariffId,
          spec.learnerAccountId,
        ],
      )
      slotIds.push(String(slotInsert.rows[0].id))
    }
    out.slots = slotIds
    console.log(`  created 3 slots (1 future-open + 2 past-booked)`)

    mkdirSync(dirname(FIXTURE_FILE), { recursive: true })
    writeFileSync(
      FIXTURE_FILE,
      JSON.stringify(out, null, 2) + '\n',
      { mode: 0o600 },
    )
    console.log(`  wrote ${FIXTURE_FILE}`)
    console.log('OK  e2e seed complete')
  } finally {
    await pool.end()
  }
}

main().catch((err) => {
  console.error(`FAIL  e2e seed: ${err.message}`)
  process.exit(1)
})
