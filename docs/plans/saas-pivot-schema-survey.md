# SaaS-pivot schema survey

Read-only survey, 2026-05-21. Scope: the 5 schema units a future SaaS-pivot
epic ("teacher_id ownership of the catalog + many-to-many learner-teacher
links") will have to migrate. Source-of-truth = `migrations/*.sql`; consumers
located by Grep across `app/`, `lib/`, `scripts/`, `tests/`.

No code-level recommendations here — just the inventory + migration risk
callouts that a future plan-mode pass needs to internalise BEFORE writing
the first migration.

---

## 1. `pricing_tariffs` table

### Schema

From `migrations/0018_pricing_tariffs.sql:23-48`:

```sql
create table if not exists pricing_tariffs (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  title_ru text not null,
  description_ru text null,
  amount_kopecks integer not null,
  currency text not null default 'RUB',
  is_active boolean not null default true,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pricing_tariffs_slug_format check (slug ~ '^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$'),
  constraint pricing_tariffs_title_len check (char_length(title_ru) between 1 and 120),
  constraint pricing_tariffs_amount_band check (amount_kopecks between 100 and 100000000),
  constraint pricing_tariffs_currency_allowlist check (currency in ('RUB'))
);
create unique index pricing_tariffs_slug_unique on pricing_tariffs (slug);
create index pricing_tariffs_active_order_idx on pricing_tariffs (display_order, id) where is_active = true;
```

Extensions:

- `migrations/0033_billing_packages_and_postpaid.sql:186-201` — installs
  trigger `pricing_tariffs_amount_guard` (BEFORE UPDATE) that refuses
  `amount_kopecks` change once any `lesson_slots.tariff_id = old.id` row
  exists.
- `migrations/0046_pricing_tariffs_duration_minutes.sql:20-64` — adds
  `duration_minutes integer not null` (band 15-240), backfilled to 60,
  then DEFAULT dropped; trigger `pricing_tariffs_duration_guard` mirrors
  the amount-immutability pattern.

### Read sites

Data-layer:
- `lib/pricing/tariffs.ts:127` — `listAllTariffs()` SELECT.
- `lib/pricing/tariffs.ts:139` — `listActiveTariffs()` SELECT.
- `lib/pricing/tariffs.ts:152` — `getTariffById(id)` SELECT.
- `lib/pricing/tariffs.ts:220, 244` — `updateTariff` pre-write probes.
- `lib/pricing/tariffs.ts:326, 333` — `deleteTariffIfUnreferenced` SELECT + ref count.

Slot/booking joins (LEFT JOIN `pricing_tariffs t on t.id = s.tariff_id`):
- `lib/scheduling/slots/queries.ts:40` — `listOpenFutureSlots`.
- `lib/scheduling/slots/queries.ts:82` — `listSlotsAsTeacher`.
- `lib/scheduling/slots/queries.ts:119` — `listSlotsForLearner`.
- `lib/scheduling/slots/queries.ts:176` — `listAllSlotsForAdmin`.
- `lib/scheduling/slots/queries.ts:223` — `listSlotsForCalendarRange`.
- `lib/scheduling/slots/booking-queries.ts:165` — `listOpenFutureSlotsForDay`.
- `lib/scheduling/slots/booking.ts:289` — postpaid branch reads tariff `amount_kopecks` / `currency`.
- `lib/scheduling/slots/mutations-write.ts:73` — `assertTariffDurationMatches` reads `duration_minutes`.

Billing readers:
- `lib/billing/paid-state.ts:53` — `getSlotPaidStatus` joins `t.amount_kopecks` as expected.
- `lib/billing/packages/debt.ts:46, 130` — postpaid debt list/aggregate join.
- `lib/payments/slot-binding.ts:56` — `validatePaymentSlotBinding`.

Admin route surface:
- `app/api/admin/pricing/route.ts:21-95` — GET/POST tariff CRUD.
- `app/api/admin/pricing/[id]/route.ts:26-188` — GET/PATCH/DELETE per-id (CRUD + delete-if-unreferenced).

### Write sites

- `lib/pricing/tariffs.ts:177-194` — `createTariff` INSERT.
- `lib/pricing/tariffs.ts:264-294` — `updateTariff` UPDATE (COALESCE-by-flag pattern).
- `lib/pricing/tariffs.ts:342-345` — `deleteTariffIfUnreferenced` DELETE inside TX.
- `tests/integration/setup.ts:42` — `truncate ... pricing_tariffs ... restart identity cascade` per test.
- `tests/integration/{billing/refunds,billing/booking,admin/pricing-crud,admin/debt-summary,payment/allocations,payment/admin-list}.test.ts` — multiple test-only INSERTs for fixtures.

### FKs in / out

- **OUT (referenced BY):** `lesson_slots.tariff_id → pricing_tariffs(id) ON DELETE SET NULL` (migration 0022:55-57). This is the only inbound FK.
- **IN (references):** none — `pricing_tariffs` does not point anywhere.
- Two triggers guard mutations: `pricing_tariffs_amount_guard`, `pricing_tariffs_duration_guard`. Both gate on `exists(select 1 from lesson_slots where tariff_id = old.id)`.

### Refactor scope estimate

~18 files to touch (1 catalog helper module + 6 slot/booking query files + 4 billing/payment readers + 2 admin route files + tests/fixtures). Plus a non-trivial migration: rename or shadow-table, backfill `teacher_id`, rewrite the two immutability triggers, swap all five slot-list LEFT JOINs. **Multi-PR (3-4 sub-waves):** schema + backfill / app-layer reads / app-layer writes / admin UI.

---

## 2. `pricing_packages` (actually `lesson_packages`) table

> **Naming note:** the migration / code calls this `lesson_packages`, not
> `pricing_packages`. Confirmed by Grep — there is no `pricing_packages`
> table anywhere in `migrations/`, `lib/`, `app/`, or `tests/`. Assuming
> the user means `lesson_packages`.

### Schema

From `migrations/0033_billing_packages_and_postpaid.sql:20-62`:

```sql
create table if not exists lesson_packages (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title_ru text not null,
  description_ru text,
  duration_minutes integer not null check (duration_minutes between 15 and 180),
  count integer not null check (count between 1 and 100),
  amount_kopecks integer not null check (amount_kopecks between 100 and 100000000),
  currency text not null default 'RUB' check (currency = 'RUB'),
  is_active boolean not null default true,
  display_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index lesson_packages_active_order_idx on lesson_packages (display_order, id) where is_active = true;
-- + trigger lesson_packages_economic_fields_guard (BEFORE UPDATE):
--   refuses change of amount_kopecks / duration_minutes / count / currency
--   once any package_purchases.package_id = old.id row exists.
```

### Read sites

Data-layer (catalog):
- `lib/billing/packages/catalog.ts:47` — `listActivePackages()` SELECT.
- `lib/billing/packages/catalog.ts:61` — `listActivePackagesByDuration()` SELECT.
- `lib/billing/packages/catalog.ts:74` — `getPackageBySlug()` SELECT.
- `lib/billing/packages/catalog.ts:86` — `getPackageById()` SELECT.
- `lib/billing/packages/catalog.ts:164` — `updatePackageMetadata` no-op probe.

Consumers:
- `lib/billing/package-grant.ts:22, 160` — webhook grant path resolves package by slug.
- `lib/scheduling/slots/booking.ts:167, 268` — booking calls `listActivePackagesByDuration` to find consumable packages.
- `app/cabinet/packages/page.tsx:8, 56` — cabinet shows catalog + per-account purchases.
- `app/api/checkout/package/[slug]/route.ts:10, 74` — `/checkout/package/[slug]` resolves by slug.
- `app/api/admin/packages/route.ts:6, 42, 65` — admin list (all, incl. archived).
- `app/api/admin/packages/[id]/route.ts:16, 20` — admin per-id metadata edit.
- `app/api/admin/packages/[id]/grant/route.ts:12, 168` — admin grant.
- `app/admin/(gated)/packages/page.tsx:37` — admin packages list page (SSR) with `exists ... package_purchases`.

### Write sites

- `lib/billing/packages/catalog.ts:106-110` — `createPackage` INSERT.
- `lib/billing/packages/catalog.ts:171-175` — `updatePackageMetadata` UPDATE (metadata only — amount/duration/count blocked by trigger).
- `app/api/admin/packages/route.ts:68-` — POST creates via `createPackage`.
- `tests/integration/billing/{refunds,admin}.test.ts`, `tests/integration/account/deletion-guard.test.ts` — test-only INSERTs.

### FKs in / out

- **OUT (referenced BY):** `package_purchases.package_id → lesson_packages(id) ON DELETE RESTRICT` (migration 0033:71).
- **IN (references):** none.
- Trigger `lesson_packages_economic_fields_guard` gates on `exists(select 1 from package_purchases where package_id = old.id)`.

### Refactor scope estimate

~10 files (`lib/billing/packages/catalog.ts` + 3 admin routes + 1 cabinet page + 1 booking helper + tests). Lighter than `pricing_tariffs` because the consumer count is smaller and there is no FK from `lesson_slots`. **Single-pass refactor or one sub-wave** once `teacher_id` is added and backfilled.

---

## 3. `accounts` + role grants

### Schema

`accounts` (from `migrations/0005_accounts.sql:12-23`; extended over time):

```sql
create table if not exists accounts (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  password_hash text not null,
  email_verified_at timestamptz null,
  disabled_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index accounts_email_unique on accounts (email);
```

Later additions material to this question:
- `migrations/0019_accounts_deletion_grace.sql` — `scheduled_purge_at`, `purged_at`.
- `migrations/0023_account_assigned_teacher.sql:24-30` — `assigned_teacher_id uuid null references accounts(id) on delete set null`.
- `migrations/0033_billing_packages_and_postpaid.sql:135-136` — `postpaid_allowed boolean not null default false`.
- `migrations/0065_accounts_learner_telegram_optin.sql` — Telegram opt-in column.

`account_roles` (from `migrations/0006_account_roles.sql:5-14`):

```sql
create table if not exists account_roles (
  account_id uuid not null references accounts(id) on delete cascade,
  role text not null check (role in ('admin', 'teacher', 'student')),
  granted_at timestamptz not null default now(),
  granted_by_account_id uuid null references accounts(id) on delete set null,
  primary key (account_id, role)
);
create index account_roles_role_idx on account_roles (role);
```

**Multi-role table** — one account can carry multiple roles. The CHECK
enumerates `'admin' | 'teacher' | 'student'`. New roles need a new
migration.

### Grant primitive — `grantAccountRole`

`lib/auth/accounts.ts:273-304` — `grantAccountRole(accountId, role, grantedByAccountId)`.

Hard rule enforced in code (not DB):
- `ADMIN_ROLE` and `CONSUMER_ROLES = ['teacher', 'student']` are **mutually exclusive**.
- Granting `admin` first deletes any teacher/student rows for the account (lines 281-286).
- Granting `teacher` or `student` REFUSES if `admin` is already held (lines 290-296, throws `role/admin_exclusive`).
- Final INSERT uses `on conflict (account_id, role) do nothing` (line 301), so re-granting is idempotent.

### List primitive — `listAccountRoles`

`lib/auth/accounts.ts:250-257` — `listAccountRoles(accountId)` returns
`role text[]` from `account_roles`. Used by every role gate.

### Guards built on the primitive

`lib/auth/guards.ts`:
- `requireAdminRole` (line 36) — `roles.includes('admin')` else 403.
- `requireLearnerArchetype` (line 112) / `requireLearnerArchetypeAndVerified` (line 124) — **deny-list**: `!roles.includes('admin') && !roles.includes('teacher')` (i.e. `student` or no role passes).
- `requireTeacherAndVerified` (line 164) — **REJECTS admin-precedence**: if `roles.includes('admin')` → 403 `admin_precedence`; otherwise requires `roles.includes('teacher')`.

Other consumers of `listAccountRoles`:
- `lib/scheduling/slots/mutations-write.ts:43` — `assertTeacherRole` on slot create.
- `lib/auth/accounts.ts:373` — `setAssignedTeacher` verifies the target carries `teacher`.
- `lib/auth/teacher-invites.ts:360` — invite redeem cross-checks the inviter still holds `teacher` via SQL `exists(select 1 from account_roles ...)`.
- `lib/auth/learner-archetype.ts:58` — canonical learner predicate.
- `lib/payments/order-account-resolver.ts:42`, `lib/payments/receipt-gate-session.ts:28`.

### Write sites (`account_roles`)

- `lib/auth/accounts.ts:282` — DELETE consumer roles when granting admin.
- `lib/auth/accounts.ts:299` — INSERT on grant.
- `lib/auth/accounts.ts:312` — DELETE on revoke (`revokeAccountRole`).
- Migrations 0006 (create) + 0029 (audit-writer role grant).
- Tests under `tests/integration/auth/` seed roles.

### FKs in / out

- `account_roles.account_id → accounts(id) ON DELETE CASCADE`.
- `account_roles.granted_by_account_id → accounts(id) ON DELETE SET NULL`.

### Refactor scope estimate

For "teacher self-registration without breaking `requireTeacher*`": the
mechanics already exist. `teacher` is a first-class role in
`account_roles`. The blocker is the **mutual-exclusion rule**
(`grantAccountRole` lines 287-296): self-registration of a teacher works
as long as the registering account is not already `admin`. Adding a
self-reg path is ~3 files touched (`/api/auth/register` accepts `role`,
calls `grantAccountRole(id, 'teacher', null)`, registration UI extended).
There is an existing planned epic for this — `docs/plans/teacher-self-reg-invite.md` (SAAS-3 + SAAS-4). **Single-pass refactor.**

---

## 4. Learner-teacher relation (`accounts.assigned_teacher_id`)

### Schema

`migrations/0023_account_assigned_teacher.sql:24-30`:

```sql
alter table accounts
  add column if not exists assigned_teacher_id uuid null
    references accounts(id) on delete set null;
create index if not exists accounts_assigned_teacher_idx
  on accounts (assigned_teacher_id)
  where assigned_teacher_id is not null;
```

Single-value, nullable, self-FK on `accounts`. Migration prose
(lines 1-22) explicitly anticipated a future move to a join table — see
"if business model evolves to multi-teacher per learner ... promoting to
a join table is straightforward and additive".

### Read sites

Auth / session:
- `lib/auth/accounts.ts:18, 50, 61, 81, 96, 152` — `Account.assignedTeacherId` is mapped from `accounts.assigned_teacher_id` in every read.
- `lib/auth/sessions.ts:56, 93-94` — `getCurrentSession` joins it onto the session row.

Scheduling reads:
- `lib/scheduling/teacher-learners.ts:45, 53` — `listLearnersForTeacher` filters by `a.assigned_teacher_id = $1`.
- `app/api/slots/available/route.ts:17, 67` — learner-side slot list forces filter to `session.account.assignedTeacherId`.
- `app/api/slots/booking-days/route.ts:26, 69` — days-with-slots forced to learner's teacher.
- `app/api/slots/booking-times/route.ts:67` — times for given day forced to learner's teacher.
- `app/api/slots/calendar/route.ts:24, 97` — learner-role projection ALWAYS uses `assignedTeacherId`.
- `app/api/slots/[id]/book/route.ts:69, 79` — booking gate refuses NULL assignedTeacher (BCS-HARDEN-1) and refuses cross-teacher booking (`auth.account.assignedTeacherId !== slot.teacher_account_id`).

Pages (Server Components):
- `app/cabinet/page.tsx:96, 98, 202-203` — cabinet shell uses it for the "your teacher" panel.
- `app/cabinet/lessons-section.tsx:36, 42, 109` — lessons block receives + uses it.
- `app/cabinet/settings/calendar/page.tsx:39` — calendar settings page reads it.
- `app/cabinet/book/page.tsx:43` — `/cabinet/book` redirects if NULL.
- `app/cabinet/book/[ymd]/[slotId]/page.tsx:44, 47, 48` — per-slot booking page cross-checks.
- `app/admin/(gated)/accounts/[id]/page.tsx:197` — admin shows current assignment.

### Write sites

- `lib/auth/accounts.ts:382-388` — `setAssignedTeacher(learnerId, teacherId | null)` with role-presence guard (raises `AssignedTeacherRoleError` if target is not a teacher).
- `lib/auth/teacher-invites.ts:340, 367` — `redeemInviteAndBindLearnerAtomic` is a single writable-CTE UPDATE that sets `assigned_teacher_id` from `verified_invite.teacher_account_id`.
- `app/api/admin/accounts/[id]/teacher/route.ts:7, 57` — admin POST endpoint for assignment.
- `app/api/auth/register/route.ts:85, 172` — register-via-invite path drives the redeem.
- Tests under `tests/integration/scheduling/` — many call `setAssignedTeacher(learner, teacher)` to seed fixtures; three (`book-busy-overlap.test.ts:70`, `book-agenda.test.ts:20`, `booking-endpoints.test.ts:55`) use raw SQL UPDATE directly.

### FKs in / out

- `accounts.assigned_teacher_id → accounts(id) ON DELETE SET NULL`.
- No other table references it.

### Refactor scope estimate

~14 source files + ~10 test files touched. The relation is "well-fenced"
(uniformly accessed via `session.account.assignedTeacherId` or
`setAssignedTeacher`), so introducing a join table `learner_teacher_links`
is mostly mechanical IF a single helper (e.g. `getLearnerTeachers(accountId)`) replaces the column read everywhere — except that **today the single-value is load-bearing**: every learner-side slot list / book / calendar route assumes "one teacher per learner". The many-to-many migration's hard part is not refactoring readers — it is **deciding the semantic** ("which teacher's slots show up in /cabinet/book when the learner has 3?" — UX picker? aggregate? primary teacher?). **Multi-PR, design-led.**

---

## 5. `lesson_slots` lineage (esp. `tariff_id` FK)

### Schema (core, from `migrations/0020_lesson_slots.sql:34-78`)

```sql
create table if not exists lesson_slots (
  id uuid primary key default gen_random_uuid(),
  teacher_account_id uuid not null references accounts(id) on delete restrict,
  start_at timestamptz not null,
  duration_minutes integer not null default 60,
  status text not null default 'open',
  learner_account_id uuid null references accounts(id) on delete restrict,
  booked_at timestamptz null,
  cancelled_at timestamptz null,
  cancelled_by_account_id uuid null references accounts(id) on delete set null,
  cancellation_reason text null,
  notes text null,
  events jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lesson_slots_status_check check (status in ('open', 'booked', 'cancelled')),
  constraint lesson_slots_duration_band check (duration_minutes between 15 and 180),
  constraint lesson_slots_booked_invariants check (...),
  constraint lesson_slots_cancelled_invariants check (...)
);
create unique index lesson_slots_teacher_start_unique on lesson_slots (teacher_account_id, start_at);
create index lesson_slots_open_future_idx on lesson_slots (start_at) where status = 'open';
create index lesson_slots_learner_idx on lesson_slots (learner_account_id, start_at desc) where learner_account_id is not null;
```

Later additions material to `tariff_id`:
- `migrations/0021_lesson_slots_lifecycle.sql:21-33` — extends status enum (`completed`, `no_show_learner`, `no_show_teacher`) and adds `marked_at`.
- `migrations/0022_payment_allocations.sql:55-61`:
  ```sql
  alter table lesson_slots
    add column if not exists tariff_id uuid null
      references pricing_tariffs(id) on delete set null;
  create index if not exists lesson_slots_tariff_idx
    on lesson_slots (tariff_id) where tariff_id is not null;
  ```
- `migrations/0031_lesson_slots_domain_invariants.sql` — three CHECK invariants (`lesson_slots_within_msk_day`, `lesson_slots_start_in_business_hours`, `lesson_slots_start_30min_aligned`).
- `migrations/0033_billing_packages_and_postpaid.sql:147-155` — `legacy_grandfathered` column.
- `migrations/0035_lesson_slots_unique_skip_cancelled.sql` — makes unique-index partial (`where status <> 'cancelled'`).
- `migrations/0042_lesson_slots_calendar_columns.sql` — Google Calendar binding columns (`external_event_id`, `external_calendar_id`, `external_event_etag`, `integration_epoch`, `external_conflict_*`, `last_reconciled_at`, `cancel_repush_count`) + partial unique on `(external_calendar_id, external_event_id)`.
- `migrations/0056_lesson_slots_zoom_url.sql` — Zoom URL column.

### Fields tied to `tariff_id`

Just one column: `lesson_slots.tariff_id uuid null references pricing_tariffs(id) ON DELETE SET NULL`. App-layer mapping is `LessonSlot.tariffId: string | null` (`lib/scheduling/slots/types.ts:103, 158, 170`).

### Read sites (booking / completion / cancel / cabinet / admin)

- `lib/scheduling/slots/internal.ts:30, 79` — `SLOT_COLUMNS` constant + `rowToSlot` mapping.
- All five `LEFT JOIN pricing_tariffs t on t.id = s.tariff_id` queries in `lib/scheduling/slots/queries.ts` (lines 40, 82, 119, 176, 223) — covers open-future, teacher view, learner view, admin view, calendar view.
- `lib/scheduling/slots/booking-queries.ts:165` — `listOpenFutureSlotsForDay`.
- `lib/scheduling/slots/booking.ts:101, 281, 289, 298` — booking flow reads `slot.tariffId` for prepaid / postpaid branch + queries `pricing_tariffs.amount_kopecks/currency` for postpaid.
- `lib/payments/slot-binding.ts:53-56` — payment validation reads expected amount via tariff join.
- `lib/billing/paid-state.ts:53` — `getSlotPaidStatus` expected-amount source.
- `lib/billing/packages/debt.ts:46, 130` — postpaid debt list + aggregate.
- `app/api/slots/calendar/route.ts:189, 203, 219` — three DTO projections include `tariffId`.

### Write sites

- `lib/scheduling/slots/mutations-write.ts:97-104` — `createSlot` accepts `input.tariffId`, validates UUID, calls `assertTariffDurationMatches` against `pricing_tariffs.duration_minutes` (lines 67-88).
- `lib/scheduling/slots/mutations-write.ts:108-127` — INSERT with `tariff_id` column.
- `lib/scheduling/slots/mutations-write.ts:152-219` — `bulkCreateSlots` (same shape, batched).
- `app/api/admin/slots/route.ts:64, 65` — admin create accepts `tariffId`.
- `app/api/admin/slots/bulk-create/route.ts:56, 57` — admin bulk-create accepts `tariffId`.
- `app/api/teacher/slots/route.ts:26, 52, 53` — teacher self-create accepts `tariffId`.
- `app/api/teacher/slots/bulk-create/route.ts:51, 52` — teacher bulk-create accepts `tariffId`.

Note: there is NO `editOpenSlot` path that mutates `tariff_id` after
INSERT — `lib/scheduling/slots/mutations-write.ts:222-261`'s `editOpenSlot`
only takes `{startAt, durationMinutes, notes}`. To "rebind tariff" today
the operator deletes + recreates the open slot.

### FKs in / out (lesson_slots)

- **OUT (lesson_slots references):**
  - `teacher_account_id → accounts(id) ON DELETE RESTRICT`
  - `learner_account_id → accounts(id) ON DELETE RESTRICT`
  - `cancelled_by_account_id → accounts(id) ON DELETE SET NULL`
  - `tariff_id → pricing_tariffs(id) ON DELETE SET NULL`
- **IN (referenced BY):**
  - `package_consumptions.slot_id → lesson_slots(id) ON DELETE RESTRICT` (migration 0033:110-111).
  - `payment_allocations` does NOT have a FK constraint to `lesson_slots` — the link is logical only (`kind='lesson_slot' AND target_id=slot.id::text`, migration 0022:38-50). This is the only "soft" lesson-slot reference.

### Refactor scope estimate

FK rename from `pricing_tariffs(id)` to `teacher_tariffs(id)` is mechanical at the SQL level (drop FK, recreate against new table, all reads use `LEFT JOIN ... t.id = s.tariff_id` and would work unchanged). BUT the **two pre-insert helpers nested in the slot-create path** — `assertTariffDurationMatches` (`lib/scheduling/slots/mutations-write.ts:67-88`) and the postpaid amount lookup (`lib/scheduling/slots/booking.ts:288-291`) — both probe `pricing_tariffs` by id directly, NOT via a join, so they need a per-call rename. Plus the two TRIGGERs (`pricing_tariffs_amount_guard`, `pricing_tariffs_duration_guard`) hardcode `exists(select 1 from lesson_slots where tariff_id = old.id)` — these must be reissued against the renamed table. **Single-PR if `teacher_tariffs` is a rename; multi-PR if it is a NEW table that coexists with `pricing_tariffs` during backfill.**

---

## Migration risks

1. **`lesson_slots.tariff_id → pricing_tariffs(id) ON DELETE SET NULL` silently wipes audit trail.** The existing `deleteTariffIfUnreferenced` helper (`lib/pricing/tariffs.ts:311-354`) refuses to DELETE a tariff if ANY slot ever pointed at it — exactly because the SET NULL would erase which tariff a past slot was bound to. Any "soft-delete a teacher tariff" pivot has the same hazard: a teacher's tariff archival must NOT nullify historical slot bindings (debt math in `lib/billing/paid-state.ts:53` + `lib/billing/packages/debt.ts:46` reads `t.amount_kopecks` for completed slots; nulled FK → expected_amount = NULL → debt vanishes from the cabinet).

2. **Two triggers + two app-layer guards encode `pricing_tariffs` table name verbatim.** `pricing_tariffs_amount_guard` (migration 0033:198-201) and `pricing_tariffs_duration_guard` (migration 0046:58-61) both reference `lesson_slots.tariff_id = old.id` against the old PK. If the pivot renames the table or shadows it, the new table needs both triggers re-created with matching FK pointers. App-layer reference-checks in `lib/pricing/tariffs.ts:214-258` query `pricing_tariffs` by name and would silently no-op if pointed at the new shadow.

3. **`grantAccountRole` admin/consumer mutual exclusion (`lib/auth/accounts.ts:259-296`) is a SaaS-pivot landmine.** Teacher self-registration paths must guarantee the registering account does NOT already hold `admin`, otherwise the grant throws `role/admin_exclusive`. Hybrid `admin+teacher` accounts are intentionally rejected (`lib/auth/guards.ts:174-185`, `requireTeacherAndVerified` rejects with `admin_precedence`). Anyone planning "operator can also be a teacher in SaaS mode" inherits a full re-design of guard semantics.

4. **`accounts.assigned_teacher_id` is read on every learner-side slot route AS A SINGLE VALUE (`session.account.assignedTeacherId`).** A many-to-many migration that leaves this column NULL after backfill (intending the join table to be the source of truth) will silently break `requireLearnerArchetypeAndVerified` consumers that read the session-cached field directly (10+ Server Components / API routes — see Q4 read sites). The session cache (`lib/auth/sessions.ts:56, 93`) must be reworked atomically with the column removal, not in a follow-up PR.

5. **`teacher_invites` redeem (`lib/auth/teacher-invites.ts:340-367`) is a single writable-CTE atomic statement that hardcodes `set assigned_teacher_id = verified_invite.teacher_account_id` and re-checks the `teacher` role in the same snapshot.** This was Codex-round-3 BLOCKER#1 of `teacher-self-reg-invite.md`. Any migration to a join table must preserve atomicity (one statement, role-check INSIDE the writable CTE), otherwise the race window re-opens — an admin grant that strips the inviter's `teacher` role between two statements could bind a learner to an ex-teacher.
