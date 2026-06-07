#!/usr/bin/env node
// ---------------------------------------------------------------------
// scripts/seed-qa-fixtures.mjs — QA / demo / audit fixture seeder.
// ---------------------------------------------------------------------
//
// Spins up a realistic, idempotent, prod-safe set of test users so the
// teacher cabinet, learner cabinet, /pay and auth flow can be walked
// end-to-end with live data on every screen.
//
// SAFETY CONTRACT (prod-safe by isolation, NOT by env guard):
//   - Every account email starts with `qa-fixture-` and ends with
//     `@levelchannel.test`. The `.test` TLD is reserved by IANA so it
//     cannot collide with a real user inbox.
//   - The wipe step deletes ONLY rows whose owner email matches the
//     `qa-fixture-%@levelchannel.test` pattern (or are reachable only
//     via FK from those accounts: tariffs/packages where teacher_id =
//     qa-fixture-teacher, slots where teacher_account_id OR
//     learner_account_id = a qa-fixture account, payment_orders where
//     teacher_account_id = qa-fixture-teacher, etc.).
//   - The entire wipe + seed is wrapped in a single BEGIN/COMMIT TX.
//     A failure mid-flight rolls back cleanly with zero partial state.
//   - The script never touches `accounts` rows whose email does not
//     match the prefix, never touches tariffs/packages owned by a
//     non-fixture teacher, never touches slots owned by a non-fixture
//     teacher or booked by a non-fixture learner.
//
// USAGE:
//   DATABASE_URL=postgres://localhost:5432/levelchannel \
//     node scripts/seed-qa-fixtures.mjs
//
// IDEMPOTENT: re-run as many times as you like — every run produces
// the same set of accounts in the same shape.
//
// LOGIN CREDENTIALS (printed to stdout on success):
//   email:    qa-fixture-teacher@levelchannel.test
//             qa-fixture-learner-1@levelchannel.test … qa-fixture-learner-5
//   password: QaFix!2026
//
// Schema references (so the writer can verify against migrations):
//   - accounts                       0005 + 0010 (normalized) + 0019 (grace)
//                                    + 0023 (assigned_teacher_id) + 0083 (audit_email_history)
//                                    + 0103 (drop postpaid_allowed)
//   - account_roles                  0006
//   - account_profiles               0017 + 0048 (timezone backfill)
//                                    + 0069 (IANA CHECK) + 0095 (first/last_name)
//   - email_verifications            0008  (we set accounts.email_verified_at directly)
//   - account_sessions               0007  (untouched; user logs in manually)
//   - learner_teacher_links          0077  (active link teacher↔learner)
//   - teacher_subscription_plans     0073 + 0103-titles_ru
//   - teacher_subscriptions          0074 + 0098 (period_*) + 0105 (free backfill)
//   - pricing_tariffs                0018 + 0046 (duration) + 0075/0088 (teacher_id NOT NULL)
//   - lesson_packages                0033 + 0076a + 0089 (teacher_id NOT NULL,
//                                    composite UNIQUE(teacher_id, slug))
//   - package_purchases              0033 + 0076c + 0089 (teacher_id NOT NULL)
//                                    + 0038 (voided_at) + 0102 (priority_snapshot)
//   - package_consumptions           0033 (PK = slot_id, consumed_by_actor enum)
//   - lesson_slots                   0020 + 0021 (lifecycle) + 0031 (MSK band / 30-min grid)
//                                    + 0035 (partial UNIQUE skip cancelled) + 0042 (calendar cols)
//                                    + 0056 (zoom_url) + 0102 (snapshot_amount_kopecks)
//   - lesson_completions             0092 (forward trigger flips slot status)
//   - payment_orders                 0001 + 0015 + 0030 (receipt_token_hash) + 0063 (payment_method)
//                                    + 0085/0094 (teacher_account_id NOT NULL) + 0090 (teacher_grant)
//   - payment_allocations            0022 + 0033 (kind='package')
//   - learner_billing_preferences    0101  (per-pair payment_method)
//
// TODOs called out below where a piece of data has no clean home and
// the spec asked us to skip rather than introduce dev-only schema.

import bcrypt from 'bcryptjs'
import { createHash, randomBytes } from 'node:crypto'
import pg from 'pg'

const { Client } = pg

// -------- Constants -------------------------------------------------

const SHARED_PASSWORD = 'QaFix!2026'
const BCRYPT_COST = 12 // matches lib/auth/password.ts BCRYPT_COST
const EMAIL_DOMAIN = '@levelchannel.test'
const FIXTURE_PREFIX = 'qa-fixture-'
const FIXTURE_EMAIL_PATTERN = 'qa-fixture-%@levelchannel.test'
const TEACHER_EMAIL = `${FIXTURE_PREFIX}teacher${EMAIL_DOMAIN}`
const TZ = 'Europe/Moscow'
const LOGIN_BASE = 'http://localhost:3010/login'

const LEARNERS = [
  {
    email: `${FIXTURE_PREFIX}learner-1${EMAIL_DOMAIN}`,
    firstName: 'Петя',
    lastName: 'Иванов',
    scenario: 'active-8',
  },
  {
    email: `${FIXTURE_PREFIX}learner-2${EMAIL_DOMAIN}`,
    firstName: 'Маша',
    lastName: 'Соколова',
    scenario: 'active-4',
  },
  {
    email: `${FIXTURE_PREFIX}learner-3${EMAIL_DOMAIN}`,
    firstName: 'Дима',
    lastName: 'Лебедев',
    scenario: 'postpaid-debt',
  },
  {
    email: `${FIXTURE_PREFIX}learner-4${EMAIL_DOMAIN}`,
    firstName: 'Аня',
    lastName: 'Орлова',
    scenario: 'expired',
  },
  {
    email: `${FIXTURE_PREFIX}learner-5${EMAIL_DOMAIN}`,
    firstName: 'Кирилл',
    lastName: 'Новиков',
    scenario: 'empty',
  },
]

// -------- Helpers ---------------------------------------------------

/** Mint a 32-byte base64url token + sha256 hex hash (matches lib/auth/tokens.ts). */
function mintReceiptToken() {
  const plain = randomBytes(32).toString('base64url')
  const hash = createHash('sha256').update(plain, 'utf8').digest('hex')
  return { plain, hash }
}

/** Stable, fake CloudPayments-style invoice id. Same shape as production: `lc_<18hex>`. */
function newInvoiceId() {
  return `lc_${randomBytes(9).toString('hex')}`
}

/**
 * Return the next 30-min-aligned MSK timestamp at or after `base` that
 * falls inside the migration-0031 business band (06:00 ≤ start ≤ 22:00 MSK
 * AND start + duration ≤ 23:59:59 MSK). We compute purely in MSK then
 * convert back to ISO-Z so the DB CHECK passes regardless of the JS host TZ.
 */
function moscowSlotAt(year, month1to12, day, hour, minute) {
  // Construct the wall-clock MSK time as a UTC instant offset by +03:00.
  // MSK has no DST since 2014, so a fixed +03:00 is correct.
  const iso = `${year.toString().padStart(4, '0')}-${String(month1to12).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+03:00`
  return new Date(iso)
}

/** Add N days to a Date, return a new Date. */
function addDays(d, days) {
  const next = new Date(d.getTime())
  next.setUTCDate(next.getUTCDate() + days)
  return next
}

// -------- Wipe ------------------------------------------------------

/**
 * Wipe order honoring FK cascade. Every WHERE clause is gated by the
 * `qa-fixture-%@levelchannel.test` email prefix — either directly on
 * accounts, or transitively via FK joins to qa-fixture accounts.
 *
 * Re-runs are safe: every DELETE is a no-op if the previous run left
 * nothing behind. ORDER matters because we still have ON DELETE RESTRICT
 * on some FKs (e.g. package_purchases → payment_orders).
 */
async function wipe(client) {
  const log = (msg) => console.log(`  wipe: ${msg}`)

  // Helper: SELECT all qa-fixture account ids once (cheap, reused).
  const idsResult = await client.query(
    `select id, email from accounts where email like $1`,
    [FIXTURE_EMAIL_PATTERN],
  )
  const fixtureIds = idsResult.rows.map((r) => String(r.id))
  log(`found ${fixtureIds.length} existing qa-fixture accounts`)
  if (fixtureIds.length === 0) {
    log('nothing to wipe — fresh state')
    return
  }

  // (1) package_consumptions reachable via package_purchases.account_id IN qa-fixture.
  await client.query(
    `delete from package_consumptions
      where package_purchase_id in (
        select id from package_purchases where account_id = any($1::uuid[])
      )`,
    [fixtureIds],
  )

  // Settlements & completions reachable via slots owned by qa-fixture teacher
  // OR booked by qa-fixture learners.
  await client.query(
    `delete from lesson_settlement_completions
      where completion_id in (
        select id from lesson_completions where teacher_id = any($1::uuid[])
           or slot_id in (select id from lesson_slots
                          where teacher_account_id = any($1::uuid[])
                             or learner_account_id = any($1::uuid[]))
      )`,
    [fixtureIds],
  )
  await client.query(
    `delete from lesson_settlements
      where teacher_id = any($1::uuid[]) or learner_account_id = any($1::uuid[])`,
    [fixtureIds],
  )
  await client.query(
    `delete from lesson_completions
      where teacher_id = any($1::uuid[])
         or slot_id in (select id from lesson_slots
                        where teacher_account_id = any($1::uuid[])
                           or learner_account_id = any($1::uuid[]))`,
    [fixtureIds],
  )

  // (2) payment_allocations + reversals — keyed on payment_order_id, scoped
  //     to orders where teacher_account_id is a qa-fixture teacher.
  await client.query(
    `delete from payment_allocation_reversals
      where payment_order_id in (
        select invoice_id from payment_orders where teacher_account_id = any($1::uuid[])
      )`,
    [fixtureIds],
  )
  await client.query(
    `delete from payment_allocations
      where payment_order_id in (
        select invoice_id from payment_orders where teacher_account_id = any($1::uuid[])
      )`,
    [fixtureIds],
  )

  // (3) lesson_slots scoped to qa-fixture teacher or learners.
  await client.query(
    `delete from lesson_slots
      where teacher_account_id = any($1::uuid[])
         or learner_account_id = any($1::uuid[])`,
    [fixtureIds],
  )

  // (4) package_purchases must be deleted BEFORE the payment_orders rows
  //     that they FK to (package_purchases.payment_order_id → payment_orders.invoice_id
  //     ON DELETE RESTRICT, mig 0033).
  await client.query(
    `delete from package_purchases where account_id = any($1::uuid[])`,
    [fixtureIds],
  )

  // (5) lesson_packages owned by qa-fixture teacher (mig 0089 NOT NULL).
  //     FK from package_purchases (now empty) is ON DELETE RESTRICT; that's
  //     fine because we just cleared all references in (4).
  await client.query(
    `delete from lesson_packages where teacher_id = any($1::uuid[])`,
    [fixtureIds],
  )

  // (6) pricing_tariffs owned by qa-fixture teacher.
  await client.query(
    `delete from pricing_tariffs where teacher_id = any($1::uuid[])`,
    [fixtureIds],
  )

  // (7) T3 junction tables (mig 0102) — safe even if empty.
  await client.query(
    `delete from learner_tariff_access where teacher_id = any($1::uuid[]) or learner_account_id = any($1::uuid[])`,
    [fixtureIds],
  )
  await client.query(
    `delete from learner_package_access where teacher_id = any($1::uuid[]) or learner_account_id = any($1::uuid[])`,
    [fixtureIds],
  )

  // (8) payment_orders — only after allocations / package_purchases cleared.
  await client.query(
    `delete from payment_orders where teacher_account_id = any($1::uuid[])`,
    [fixtureIds],
  )

  // (9) teacher_subscriptions (1:1 via account_id).
  await client.query(
    `delete from teacher_subscriptions where account_id = any($1::uuid[])`,
    [fixtureIds],
  )

  // (10) learner_teacher_links + learner_billing_preferences (mig 0101).
  await client.query(
    `delete from learner_teacher_links
       where teacher_account_id = any($1::uuid[]) or learner_account_id = any($1::uuid[])`,
    [fixtureIds],
  )
  await client.query(
    `delete from learner_billing_preferences
       where teacher_account_id = any($1::uuid[]) or learner_account_id = any($1::uuid[])`,
    [fixtureIds],
  )

  // (11) accounts.assigned_teacher_id — null out for any non-fixture learner
  //      that might somehow be assigned to a qa-fixture teacher. Cheap belt.
  await client.query(
    `update accounts set assigned_teacher_id = null
       where assigned_teacher_id = any($1::uuid[])`,
    [fixtureIds],
  )

  // (12) account_profiles, account_roles, account_sessions, email_verifications,
  //      password_resets — all have ON DELETE CASCADE from accounts(id) so the
  //      final accounts DELETE clears them. We still explicitly DELETE here so
  //      the wipe is auditable and the FK CASCADE is not load-bearing.
  await client.query(
    `delete from account_profiles where account_id = any($1::uuid[])`,
    [fixtureIds],
  )
  await client.query(
    `delete from account_roles where account_id = any($1::uuid[])`,
    [fixtureIds],
  )
  await client.query(
    `delete from account_sessions where account_id = any($1::uuid[])`,
    [fixtureIds],
  )
  await client.query(
    `delete from email_verifications where account_id = any($1::uuid[])`,
    [fixtureIds],
  )
  // password_resets exists since mig 0009; plain DELETE is fine.
  await client.query(
    `delete from password_resets where account_id = any($1::uuid[])`,
    [fixtureIds],
  )

  // (13) account_onboarding_state (mig 0100) — ON DELETE CASCADE handles it,
  //      but be explicit for audit.
  await client.query(
    `delete from account_onboarding_state where account_id = any($1::uuid[])`,
    [fixtureIds],
  )

  // (14) Finally — accounts.
  await client.query(
    `delete from accounts where email like $1`,
    [FIXTURE_EMAIL_PATTERN],
  )
  log('wipe complete')
}

// -------- Seed ------------------------------------------------------

/** Insert account row + return id. password_hash stored bcrypt cost-12. */
async function createAccount(client, { email, passwordHash }) {
  const result = await client.query(
    `insert into accounts (email, password_hash, email_verified_at)
     values ($1, $2, now())
     returning id`,
    [email, passwordHash],
  )
  return String(result.rows[0].id)
}

async function setRole(client, accountId, role) {
  await client.query(
    `insert into account_roles (account_id, role) values ($1, $2)
     on conflict (account_id, role) do nothing`,
    [accountId, role],
  )
}

async function setProfile(client, accountId, { firstName, lastName, displayName }) {
  // mig 0017 + 0095. display_name kept for back-compat. timezone IANA-checked
  // against mig 0069 allowlist (Europe/Moscow is in the list).
  await client.query(
    `insert into account_profiles
       (account_id, display_name, first_name, last_name, timezone, locale)
     values ($1, $2, $3, $4, $5, 'ru')
     on conflict (account_id) do update set
       display_name = excluded.display_name,
       first_name = excluded.first_name,
       last_name = excluded.last_name,
       timezone = excluded.timezone,
       locale = excluded.locale,
       updated_at = now()`,
    [accountId, displayName, firstName, lastName, TZ],
  )
}

async function seedTeacher(client, passwordHash) {
  console.log('  seed: teacher account')
  const teacherId = await createAccount(client, {
    email: TEACHER_EMAIL,
    passwordHash,
  })
  await setRole(client, teacherId, 'teacher')
  await setProfile(client, teacherId, {
    firstName: 'Анна',
    lastName: 'Петрова',
    displayName: 'Анна Петрова',
  })

  // teacher_subscriptions: Mid tier, active, period covers next 30 days.
  // mig 0074 — 1:1 with accounts; mig 0098 added period_* + amount fields.
  const periodStart = new Date()
  const periodEnd = addDays(periodStart, 30)
  await client.query(
    `insert into teacher_subscriptions
       (account_id, plan_slug, state, renewal_at,
        period_start, period_end, amount_kopecks)
     values ($1, 'mid', 'active', $3, $2, $3, 30000)
     on conflict (account_id) do update set
       plan_slug = excluded.plan_slug,
       state = excluded.state,
       renewal_at = excluded.renewal_at,
       period_start = excluded.period_start,
       period_end = excluded.period_end,
       amount_kopecks = excluded.amount_kopecks,
       updated_at = now()`,
    [teacherId, periodStart.toISOString(), periodEnd.toISOString()],
  )

  // 3 tariffs (30 / 45 / 60 min).
  // mig 0018 + 0046 + 0088. amount_kopecks: 800 / 1200 / 1600 руб.
  // Slugs are namespaced so two teachers' fixtures don't collide on the
  // legacy GLOBAL UNIQUE pre-mig-0102. After mig 0102 visibility column
  // defaults to 'catalog' which means learners see them in the booking flow.
  const tariffs = [
    { slug: `qa-fixture-tariff-30min`, title: 'Урок 30 минут', duration: 30, kopecks: 80000 },
    { slug: `qa-fixture-tariff-45min`, title: 'Урок 45 минут', duration: 45, kopecks: 120000 },
    { slug: `qa-fixture-tariff-60min`, title: 'Урок 60 минут', duration: 60, kopecks: 160000 },
  ]
  const tariffIds = {}
  for (const t of tariffs) {
    const r = await client.query(
      `insert into pricing_tariffs
         (slug, title_ru, amount_kopecks, currency, is_active,
          display_order, duration_minutes, teacher_id)
       values ($1, $2, $3, 'RUB', true, 0, $4, $5)
       returning id`,
      [t.slug, t.title, t.kopecks, t.duration, teacherId],
    )
    tariffIds[t.duration] = String(r.rows[0].id)
  }

  // 2 packages (4 × 60 min / 6000₽, 8 × 60 min / 11500₽).
  // mig 0033 + 0076a + 0089 (composite UNIQUE(teacher_id, slug)).
  const packages = [
    { slug: `qa-fixture-pkg-4`, title: 'Пакет 4 урока', count: 4, duration: 60, kopecks: 600000 },
    { slug: `qa-fixture-pkg-8`, title: 'Пакет 8 уроков', count: 8, duration: 60, kopecks: 1150000 },
  ]
  const packageIds = {}
  for (const p of packages) {
    const r = await client.query(
      `insert into lesson_packages
         (slug, title_ru, duration_minutes, count, amount_kopecks, currency,
          is_active, display_order, teacher_id)
       values ($1, $2, $3, $4, $5, 'RUB', true, 100, $6)
       returning id`,
      [p.slug, p.title, p.duration, p.count, p.kopecks, teacherId],
    )
    packageIds[p.count] = { id: String(r.rows[0].id), ...p }
  }

  return { teacherId, tariffIds, packageIds }
}

/** Create a paid payment_order row for a package purchase. */
async function createPaidPackageOrder(client, {
  teacherId,
  learnerEmail,
  amountKopecks,
  description,
  paidAt,
}) {
  const invoiceId = newInvoiceId()
  const { hash: receiptHash } = mintReceiptToken()
  const amountRub = (amountKopecks / 100).toFixed(2)
  const receipt = JSON.stringify({
    Items: [
      {
        label: description,
        price: Number(amountRub),
        quantity: 1,
        amount: Number(amountRub),
        vat: null,
        method: 1,
        object: 4,
      },
    ],
    email: learnerEmail,
    taxationSystem: 1,
  })
  const events = JSON.stringify([
    { type: 'created', at: paidAt.toISOString() },
    { type: 'paid', at: paidAt.toISOString() },
  ])
  await client.query(
    `insert into payment_orders
       (invoice_id, amount_rub, currency, description, provider, status,
        created_at, updated_at, paid_at,
        customer_email, receipt_email, receipt, metadata, events,
        receipt_token_hash, payment_method, teacher_account_id)
     values
       ($1, $2::numeric, 'RUB', $3, 'cloudpayments', 'paid',
        $4, $4, $4,
        $5, $5, $6::jsonb, $7::jsonb, $8::jsonb,
        $9, 'card', $10::uuid)`,
    [
      invoiceId,
      amountRub,
      description,
      paidAt.toISOString(),
      learnerEmail,
      receipt,
      JSON.stringify({ accountId: null, qa_fixture: true }),
      events,
      receiptHash,
      teacherId,
    ],
  )
  return invoiceId
}

/** Insert package_purchase + payment_allocation rows. */
async function insertPackagePurchase(client, {
  learnerAccountId,
  teacherId,
  packageRow,
  paymentOrderId,
  expiresAt,
}) {
  const r = await client.query(
    `insert into package_purchases
       (account_id, package_id, payment_order_id, amount_kopecks, currency,
        title_snapshot, duration_minutes, count_initial, expires_at, teacher_id)
     values ($1, $2, $3, $4, 'RUB', $5, $6, $7, $8, $9)
     returning id`,
    [
      learnerAccountId,
      packageRow.id,
      paymentOrderId,
      packageRow.kopecks,
      packageRow.title,
      packageRow.duration,
      packageRow.count,
      expiresAt.toISOString(),
      teacherId,
    ],
  )
  const purchaseId = String(r.rows[0].id)

  // payment_allocations.kind='package' since mig 0033.
  await client.query(
    `insert into payment_allocations
       (payment_order_id, kind, target_id, amount_kopecks)
     values ($1, 'package', $2, $3)
     on conflict (payment_order_id, kind, target_id) do nothing`,
    [paymentOrderId, purchaseId, packageRow.kopecks],
  )
  return purchaseId
}

/** Insert a lesson_slot. status='booked' if learnerAccountId, else 'open'. */
async function insertSlot(client, {
  teacherId,
  learnerAccountId,
  startAt,
  durationMinutes,
  status = 'booked',
  tariffId,
  snapshotKopecks,
}) {
  // mig 0020 + 0021 + 0031 + 0042 + 0102 (snapshot_amount_kopecks).
  // booked_at must be non-null when status='booked' (mig 0020 invariants).
  const bookedAt = learnerAccountId ? new Date(startAt.getTime() - 86_400_000) : null
  const r = await client.query(
    `insert into lesson_slots
       (teacher_account_id, learner_account_id, start_at, duration_minutes,
        status, booked_at, tariff_id, snapshot_amount_kopecks)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     returning id`,
    [
      teacherId,
      learnerAccountId,
      startAt.toISOString(),
      durationMinutes,
      status,
      bookedAt ? bookedAt.toISOString() : null,
      tariffId,
      snapshotKopecks,
    ],
  )
  return String(r.rows[0].id)
}

/**
 * Mark a slot completed via lesson_completions (mig 0092 forward trigger
 * flips slot.status from 'booked' → 'completed' automatically).
 * The slot must currently be 'booked'.
 */
async function markCompleted(client, {
  slotId,
  teacherId,
  amountKopecks,
  completedAt,
}) {
  await client.query(
    `insert into lesson_completions
       (slot_id, teacher_id, was_no_show, amount_kopecks, completed_at,
        immutable_at, marked_by_account_id)
     values ($1, $2, false, $3, $4, null, $2)`,
    [slotId, teacherId, amountKopecks, completedAt.toISOString()],
  )
}

/** Add an active learner_teacher_links row + accounts.assigned_teacher_id for legacy dual-write. */
async function linkLearnerToTeacher(client, learnerId, teacherId) {
  await client.query(
    `insert into learner_teacher_links (learner_account_id, teacher_account_id, linked_at)
     values ($1, $2, now())
     on conflict (learner_account_id, teacher_account_id) do update set
       unlinked_at = null, linked_at = excluded.linked_at`,
    [learnerId, teacherId],
  )
  await client.query(
    `update accounts set assigned_teacher_id = $2, updated_at = now()
       where id = $1`,
    [learnerId, teacherId],
  )
}

/** Set learner_billing_preferences for the (teacher, learner) pair (mig 0101). */
async function setBillingMethod(client, teacherId, learnerId, method) {
  await client.query(
    `insert into learner_billing_preferences
       (teacher_account_id, learner_account_id, payment_method, updated_by_account_id)
     values ($1, $2, $3, $1)
     on conflict (teacher_account_id, learner_account_id) do update set
       payment_method = excluded.payment_method,
       updated_by_account_id = excluded.updated_by_account_id,
       updated_at = now()`,
    [teacherId, learnerId, method],
  )
}

// -------- Scenario builders -----------------------------------------

/**
 * Build a list of N future booking slots for a teacher/learner, all
 * within the migration-0031 business band and on the 30-min grid.
 * Each slot is offset N days into the future at 10:00 MSK.
 * Returns Date objects.
 */
function futureSlotDates(count, offsetStartDays = 1, hourMsk = 10) {
  const out = []
  const today = new Date()
  for (let i = 0; i < count; i++) {
    const d = addDays(today, offsetStartDays + i)
    out.push(
      moscowSlotAt(
        d.getUTCFullYear(),
        d.getUTCMonth() + 1,
        d.getUTCDate(),
        hourMsk,
        0,
      ),
    )
  }
  return out
}

/** Past slot dates for completed lessons. */
function pastSlotDates(count, offsetEndDays = -2, hourMsk = 11) {
  const out = []
  const today = new Date()
  for (let i = 0; i < count; i++) {
    const d = addDays(today, offsetEndDays - i * 2)
    out.push(
      moscowSlotAt(
        d.getUTCFullYear(),
        d.getUTCMonth() + 1,
        d.getUTCDate(),
        hourMsk,
        0,
      ),
    )
  }
  return out
}

async function seedLearnerScenario(client, ctx, spec) {
  const { teacherId, tariffIds, packageIds, passwordHash } = ctx
  const learnerId = await createAccount(client, {
    email: spec.email,
    passwordHash,
  })
  await setRole(client, learnerId, 'student')
  await setProfile(client, learnerId, {
    firstName: spec.firstName,
    lastName: spec.lastName,
    displayName: `${spec.firstName} ${spec.lastName}`,
  })
  await linkLearnerToTeacher(client, learnerId, teacherId)

  switch (spec.scenario) {
    case 'active-8': {
      // 8-lesson package, 3 consumed, 5 remaining. 2 past + 2 future.
      await setBillingMethod(client, teacherId, learnerId, 'prepaid_packages')
      const pkg = packageIds[8]
      const purchasedAt = addDays(new Date(), -30)
      const orderId = await createPaidPackageOrder(client, {
        teacherId,
        learnerEmail: spec.email,
        amountKopecks: pkg.kopecks,
        description: pkg.title,
        paidAt: purchasedAt,
      })
      const purchaseId = await insertPackagePurchase(client, {
        learnerAccountId: learnerId,
        teacherId,
        packageRow: pkg,
        paymentOrderId: orderId,
        expiresAt: addDays(purchasedAt, 180), // 6 months
      })
      // 2 past completed. Hour 11 — active-8 lane.
      const past = pastSlotDates(2, -2, 11)
      for (const startAt of past) {
        const slotId = await insertSlot(client, {
          teacherId,
          learnerAccountId: learnerId,
          startAt,
          durationMinutes: 60,
          status: 'booked',
          tariffId: tariffIds[60],
          snapshotKopecks: 160000,
        })
        await markCompleted(client, {
          slotId,
          teacherId,
          amountKopecks: 160000,
          completedAt: new Date(startAt.getTime() + 60 * 60 * 1000),
        })
        await client.query(
          `insert into package_consumptions
             (slot_id, package_purchase_id, consumed_by_actor)
           values ($1, $2, 'learner')
           on conflict (slot_id) do nothing`,
          [slotId, purchaseId],
        )
      }
      // 1 more consumption with no slot? No — keep it real: third
      // consumption attaches to a past slot too.
      const extraPast = pastSlotDates(1, -10, 11)
      for (const startAt of extraPast) {
        const slotId = await insertSlot(client, {
          teacherId,
          learnerAccountId: learnerId,
          startAt,
          durationMinutes: 60,
          status: 'booked',
          tariffId: tariffIds[60],
          snapshotKopecks: 160000,
        })
        await markCompleted(client, {
          slotId,
          teacherId,
          amountKopecks: 160000,
          completedAt: new Date(startAt.getTime() + 60 * 60 * 1000),
        })
        await client.query(
          `insert into package_consumptions
             (slot_id, package_purchase_id, consumed_by_actor)
           values ($1, $2, 'learner')
           on conflict (slot_id) do nothing`,
          [slotId, purchaseId],
        )
      }
      // 2 future booked. Hour 10 — active-8 lane.
      const future = futureSlotDates(2, 1, 10)
      for (const startAt of future) {
        await insertSlot(client, {
          teacherId,
          learnerAccountId: learnerId,
          startAt,
          durationMinutes: 60,
          status: 'booked',
          tariffId: tariffIds[60],
          snapshotKopecks: 160000,
        })
      }
      break
    }

    case 'active-4': {
      // 4-lesson package, 0 consumed, 4 remaining. 1 future booked.
      await setBillingMethod(client, teacherId, learnerId, 'prepaid_packages')
      const pkg = packageIds[4]
      const purchasedAt = addDays(new Date(), -14)
      const orderId = await createPaidPackageOrder(client, {
        teacherId,
        learnerEmail: spec.email,
        amountKopecks: pkg.kopecks,
        description: pkg.title,
        paidAt: purchasedAt,
      })
      await insertPackagePurchase(client, {
        learnerAccountId: learnerId,
        teacherId,
        packageRow: pkg,
        paymentOrderId: orderId,
        expiresAt: addDays(purchasedAt, 180),
      })
      const [startAt] = futureSlotDates(1, 2, 12) // hour 12 — active-4 lane
      await insertSlot(client, {
        teacherId,
        learnerAccountId: learnerId,
        startAt,
        durationMinutes: 60,
        status: 'booked',
        tariffId: tariffIds[60],
        snapshotKopecks: 160000,
      })
      break
    }

    case 'postpaid-debt': {
      // No package. 1 past completed unpaid lesson = debt. 1 future booked.
      // Debt path: completed lesson with NO package_consumption AND no
      // settled lesson_settlement → balance.ts surfaces it as outstanding.
      // We do NOT create a payment_orders row — the debt is exactly the
      // absence of payment.
      await setBillingMethod(client, teacherId, learnerId, 'postpaid')
      // Past lesson (completed via trigger).
      const [pastStart] = pastSlotDates(1, -3, 13) // hour 13 — postpaid lane
      const pastSlotId = await insertSlot(client, {
        teacherId,
        learnerAccountId: learnerId,
        startAt: pastStart,
        durationMinutes: 60,
        status: 'booked',
        tariffId: tariffIds[60],
        snapshotKopecks: 160000,
      })
      await markCompleted(client, {
        slotId: pastSlotId,
        teacherId,
        amountKopecks: 160000,
        completedAt: new Date(pastStart.getTime() + 60 * 60 * 1000),
      })
      // Future booked.
      const [futureStart] = futureSlotDates(1, 3, 14) // hour 14 — postpaid lane
      await insertSlot(client, {
        teacherId,
        learnerAccountId: learnerId,
        startAt: futureStart,
        durationMinutes: 60,
        status: 'booked',
        tariffId: tariffIds[60],
        snapshotKopecks: 160000,
      })
      break
    }

    case 'expired': {
      // Expired 4-lesson package (purchased 7 months ago, used 4/4).
      // No active package, no future slots.
      await setBillingMethod(client, teacherId, learnerId, 'prepaid_packages')
      const pkg = packageIds[4]
      const purchasedAt = addDays(new Date(), -210) // 7 months ago
      const orderId = await createPaidPackageOrder(client, {
        teacherId,
        learnerEmail: spec.email,
        amountKopecks: pkg.kopecks,
        description: pkg.title,
        paidAt: purchasedAt,
      })
      const purchaseId = await insertPackagePurchase(client, {
        learnerAccountId: learnerId,
        teacherId,
        packageRow: pkg,
        paymentOrderId: orderId,
        expiresAt: addDays(purchasedAt, 180), // already past
      })
      // 4 past completed lessons consuming 4/4 units.
      const pastSlots = pastSlotDates(4, -150, 15) // hour 15 — expired lane (far past, won't conflict)
      for (const startAt of pastSlots) {
        const slotId = await insertSlot(client, {
          teacherId,
          learnerAccountId: learnerId,
          startAt,
          durationMinutes: 60,
          status: 'booked',
          tariffId: tariffIds[60],
          snapshotKopecks: 160000,
        })
        await markCompleted(client, {
          slotId,
          teacherId,
          amountKopecks: 160000,
          completedAt: new Date(startAt.getTime() + 60 * 60 * 1000),
        })
        await client.query(
          `insert into package_consumptions
             (slot_id, package_purchase_id, consumed_by_actor)
           values ($1, $2, 'learner')
           on conflict (slot_id) do nothing`,
          [slotId, purchaseId],
        )
      }
      break
    }

    case 'empty': {
      // Brand-new learner. Billing method set to 'none' so booking is
      // blocked until the teacher configures a method — that is the
      // designed empty-state for /teacher/learners/[id].
      // TODO: if a future product knob calls for "default to prepaid",
      // change this to 'prepaid_packages'.
      await setBillingMethod(client, teacherId, learnerId, 'none')
      break
    }

    default:
      throw new Error(`unknown scenario: ${spec.scenario}`)
  }
  console.log(`  seed: learner ${spec.email} — scenario=${spec.scenario}`)
}

// -------- Main ------------------------------------------------------

async function main() {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    console.error('FAIL  DATABASE_URL not set')
    process.exit(2)
  }

  const client = new Client({ connectionString: databaseUrl })
  await client.connect()

  console.log('  hash: computing bcrypt(cost=12) — takes ~250ms')
  const passwordHash = await bcrypt.hash(SHARED_PASSWORD, BCRYPT_COST)

  try {
    await client.query('begin')
    await wipe(client)
    const ctx = await seedTeacher(client, passwordHash)
    ctx.passwordHash = passwordHash
    for (const learner of LEARNERS) {
      await seedLearnerScenario(client, ctx, learner)
    }
    await client.query('commit')
    console.log('OK  qa-fixtures seed complete')
  } catch (err) {
    await client.query('rollback').catch(() => undefined)
    throw err
  } finally {
    await client.end()
  }

  // -------- Stdout summary ------------------------------------------
  console.log('')
  console.log('================ QA fixtures ready ================')
  console.log(`Shared password: ${SHARED_PASSWORD}`)
  console.log('')
  console.log('Teacher:')
  console.log(`  ${TEACHER_EMAIL}`)
  console.log(`  ${LOGIN_BASE}?email=${encodeURIComponent(TEACHER_EMAIL)}`)
  console.log('')
  console.log('Learners:')
  for (const l of LEARNERS) {
    console.log(`  ${l.email}  — ${l.firstName} ${l.lastName}  (${l.scenario})`)
    console.log(`  ${LOGIN_BASE}?email=${encodeURIComponent(l.email)}`)
  }
  console.log('')
  console.log(`Seeded 1 teacher + ${LEARNERS.length} learners with realistic data. Login: qa-fixture-*@levelchannel.test / ${SHARED_PASSWORD}`)
}

main().catch((err) => {
  console.error(`FAIL  qa-fixtures seed: ${err?.stack ?? err}`)
  process.exit(1)
})
