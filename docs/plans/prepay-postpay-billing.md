# Pre-paid packages + Post-paid debt — billing model wave

**Status:** plan v9 (post Codex round 8). **Codex SIGN-OFF: APPROVED (round 9, no new findings).**

Self-paranoia review by Claude (round 10): one factual fix — referenced function name was `scheduleAccountDeletion` in earlier rounds; the actual function in `lib/auth/accounts.ts:392` is `requestAccountDeletion`. Updated throughout. Otherwise no further blockers found in the doc.
**Owner:** Ivan + Claude.
**Estimate:** 4-6 PRs across ~2-3 working days.
**Source-of-truth:** this document.

## What we're building

LevelChannel today supports a single billing shape: per-slot one-shot payment via `/checkout/[tariffSlug]?slot=<id>`, with booking gated only on auth + verification. We're moving to two parallel containers, both first-class:

1. **Prepaid packages** — learner buys e.g. "10 lessons × 60 min" up front. Each booking decrements one unit. Primary path for new clients.
2. **Postpaid debt** — loyal long-term clients book without prepay; the system tracks unpaid completed lessons and surfaces them as a settle-up list. Postpaid is opt-in per-account, gated by an admin-controlled flag.

Two containers, no merged ledger. A learner has package(s) AND/OR a list of unpaid completed slots.

## Codex round 8 — paid-but-not-yet-granted gap closed, v8 → v9

Round 8 confirmed v8's fixes landed clean but caught a residual MEDIUM in the deletion guard:

- **MEDIUM (paid-not-granted gap)**: the deletion-guard predicate blocked only `pending/3ds_required` orders within 15 minutes. It missed orders that already transitioned to `paid` but whose webhook hadn't yet materialized a `package_purchases` row — either because the webhook is mid-retry after a transient operational failure, OR because the webhook simply hasn't fired yet. In that window, deletion would proceed, then the webhook retry would fail-closed (`no_account_match` because the account is anonymized) and a paid order would lose its package. v9 widens the predicate: deletion is ALSO blocked when a `paid` order exists for the account with no `package_purchases` row yet (i.e. payment captured, grant not landed).

The widened predicate is now: `EXISTS pending/3ds_required-within-15-min OR EXISTS paid-without-package_purchases`. This blocks the full surface of "money captured, grant in-flight" cases.

## Codex round 7 — deletion-guard predicate + execution-step re-check, v7 → v8

Round 7 confirmed taxonomy fix landed clean but caught two leaks in the account-lifecycle subsection:

- **MEDIUM (predicate missing the 15-min window)**: the normative `EXISTS (...)` predicate in the deletion-guard text dropped `created_at > now() - interval '15 minutes'` from the conditions, even though the surrounding prose said "the 15-minute pending window ensures the lock is brief". Without the bound, a stuck old pending order could block deletion forever. v8 puts the bound back into the canonical predicate.
- **MEDIUM (guard at scheduling only, not execution)**: `account_deletion_grace` (migration 0019) is a two-step flow — operator schedules deletion, then a janitor cron later anonymizes once the grace period expires. v7 only pinned the schedule-step guard. A pending package order that materializes AFTER scheduling but BEFORE the cron runs would slip through. v8 adds an explicit re-check at the anonymize-execution path: the cron-side anonymizer re-evaluates the same predicate and skips/defers any account with an in-flight package grant.

## Codex round 6 — account-lifecycle policy + taxonomy alignment, v6 → v7

Round 6 confirmed v6's HIGH+MEDIUM landed but caught 2 MEDIUM:

- **MEDIUM (account lifecycle)**: in-flight package grant + account anonymize/delete/merge between checkout-init and webhook was unspecified. v7 adds an explicit policy section: account anonymize / scheduled-delete is REFUSED while any `package_purchases` materialization is pending (i.e. a `payment_orders` row with `metadata.packageSlug IS NOT NULL` and `status IN ('pending','3ds_required')` and `created_at > now() - interval '15 minutes'` for the same `metadata.accountId`). Account merge is not a feature today and is documented as not supported. Email change is the existing fail-closed path with operator reconciliation. The window is bounded by the same 15-minute pending gate, so the lock is brief.
- **MEDIUM (taxonomy)**: doc said "five" then "six" then enumerated seven semantic reasons. v7 pins SEVEN as the canonical count and uses it consistently across summary, contract, decisions log, and tests. The seven reasons: `no_metadata_accountid`, `metadata_accountid_unknown`, `no_ciphertext`, `decrypt_failed`, `no_account_match`, `multi_account_match`, `metadata_email_mismatch`.

## Codex round 5 — final ownership corroboration + retry semantics, v5 → v6

Round 5 confirmed `available_packages` cap alignment but caught:

- **HIGH**: `customer_email` source not pinned as server-authored. v5 pinned that the ciphertext is written via `createPayment()`, but did NOT pin where the plaintext value comes from. If any code path lets a client-supplied email reach `createPayment()`, ownership becomes forgeable. v6 adds an explicit invariant: `customer_email` MUST come from `accounts.email` of the authenticated session at checkout-init time. Never request body, never query, never form. New integration test pins this — checkout init with a `customer_email` in the body different from the session's account email is silently overridden by the session value.
- **MEDIUM (corroboration)**: ownership lived only on email-decrypt. v6 makes it dual-key: webhook resolves owner via BOTH `metadata.accountId` AND `decrypt(customer_email_enc)` independently, and they MUST agree. Either resolution failing or the two disagreeing → fail-closed. This closes the email-drift edge case where a user changed their email between checkout and webhook (benign drift → fail-closed → operator manual review).
- **MEDIUM (retry semantics)**: v5 said `fail_closed → 200` blanket. v6 splits permanent semantic failures from transient operational ones. Only the SEVEN well-defined ownership failures (no_metadata_accountid / metadata_accountid_unknown / no_ciphertext / decrypt_failed / no_account_match / multi_account_match / metadata_email_mismatch) return 200 (no retry). DB outage / tx abort / deadlock / read failure / allocation insert failure throw → handler returns 5xx → CloudPayments retries. Otherwise a paid order can be permanently black-holed.
- LOW prose drift: `Failure shapes` block now mentions the top-3 cap on `available_packages` (was just "filtered").

## Codex round 4 — email-match ownership contract pinned, v4 → v5

Round 4 confirmed v4's structural fixes landed; residual concern was the "decrypt-and-match" ownership story not being pinned tightly enough. v5 adds:

- A formal "Webhook ownership contract" subsection in PR 2 spelling out: package checkout init MUST write `customer_email_enc` via the existing payment-order writer (same path that other CloudPayments orders use); webhook handler resolves owner by `normalizeEmail(decryptViaAuditKey(customer_email_enc)) = accounts.email_normalized`; fail-closed on null ciphertext, decrypt failure, no match, or non-unique match (= reject the grant, log audit event, do not silently coerce).
- One new integration test covering the fail-closed paths (decrypt-fail / no-match / multi-match).
- LOW alignment: test matrix entry for `package_required` 402 includes the explicit "top-3 by display_order" filter.

## Codex round 3 — final residual fixes from v3 → v4

Round 3 confirmed v3's structural fixes landed but caught:

- **HIGH (new)**: Trust boundary on `payment_orders.metadata` was implicit. v3 said "write metadata at checkout init time" without specifying who authors which field. v4 fixes this in PR 2 description and in a new "Trust boundary" subsection: `accountId` from authenticated session ONLY (never client body), `packageSlug` from URL path lookup against the `lesson_packages` table, `packageDurationMinutes` looked up server-side from the package row, never trusted from client. The booking-side gate predicate trusts these because they were server-authored at write time. Webhook handler also does NOT use metadata as the source of truth for ownership — it uses `payment_orders.customer_email_enc` decrypted-and-matched to an account, with metadata as the lookup hint only.
- **MEDIUM (test flag)**: `BILLING_WAVE_ACTIVE` test/integration behavior added — integration suite boots the app with the flag set to `true` so the new path is exercised. Documented in PR 1.
- **MEDIUM (summary mention)**: top summary bullet for HIGH 2 now lists `packageDurationMinutes` explicitly.
- Doc-consistency: removed leftover `start_at > now()` SQL from `legacy_grandfathered` section (single source of truth lives in "Predicate-based grandfathering with a literal cutover"); fixed Persona A copy to be advisory ("≈9 после записи — точное число подтвердится"); rewrote `package_consumptions` schema comment to drop the contradiction.

## Codex round 2 — additional fixes from v2 → v3

Round 2 (2026-05-09) confirmed the structural rewrite was correct but caught 3 HIGH + 4 MEDIUM + 2 LOW. Applied:

- **HIGH 1**: `paid-state` SQL had a money bug — `LEFT JOIN payment_orders ON ... AND status='paid'` does NOT filter the SUM. Fixed: `SUM(CASE WHEN o.invoice_id IS NOT NULL THEN a.amount_kopecks ELSE 0 END)` — only allocations whose order joined as `paid` count.
- **HIGH 2**: Race between package checkout init and booking. Learner clicks "Buy package" → CloudPayments redirect → `pay.processed` webhook arrives ~5–30 s later. If the learner books a slot in that window with `postpaid_allowed=true`, the slot enters postpaid debt even though a paid package will materialize moments later. Fixed: booking flow refuses postpaid fallback when the account has a pending package order matching this slot's duration in the last 15 minutes. Predicate filters on all three metadata fields written at server-authored checkout init: `metadata->>'accountId' = $learner`, `metadata->>'packageSlug' IS NOT NULL`, AND `metadata->>'packageDurationMinutes' = $slot.duration_minutes::text`, plus `status IN ('pending','3ds_required')` and `created_at > now() - interval '15 minutes'`. Returns 409 `pending_package_grant`. Mismatched durations (e.g. 60-min package pending while user books a 90-min slot) bypass the gate — that's the right behavior, postpaid fallback applies normally.
- **HIGH 3**: `payment_orders.paid_at` column existence verified — exists since migration 0001, set on `markOrderPaid`. Removed the TODO call-out.
- **MEDIUM 1**: Feature flag source specified — `process.env.BILLING_WAVE_ACTIVE` read at process start, deploy-time restart required. Single instance today, no hot-reload coordination needed.
- **MEDIUM 2**: `payment_allocations` already has composite PK `(payment_order_id, kind, target_id)` from migration 0022. For package branch: `target_id = package_purchases.id`. Replay → PK conflict → no duplicate. The `package_purchases.payment_order_id UNIQUE` covers the purchase row; the allocation PK covers the money row. Both required, both DB-enforced.
- **MEDIUM 3**: Grandfathering predicate uses a literal cutover timestamp passed at migration creation time (`'2026-05-09T00:00:00Z'::timestamptz` baked into the migration), not `now()`. Replays on dev/staging produce the same set.
- **MEDIUM 4**: Removed invalid `WHERE expires_at > now()` partial index from DDL. Replaced with a regular composite index; expiry filter lives in the query.
- **LOW 1**: BookConfirmModal billing-preview labelled as advisory ("Останется ≈9 после записи") — copy makes the count non-authoritative.
- **LOW 2**: `package_consumptions` section reworded — `slot_id` is PK, no second consumption ever happens for the same slot. The earlier "new row on restore-rebook" line was wrong and was removed.

## Codex round 1 — what changed structurally from v1

Codex round 1 (2026-05-09) flagged that v1 tried to track money through mutable counters and a nullable FK on slots. Real money is append-only. v2 reshapes the data model around an immutable ledger:

- **NEW**: `package_consumptions` table (slot_id, package_purchase_id, consumed_at, restored_at). One row per consumption event. Restore = stamp `restored_at`, never delete. Slot-purchase linkage moves from a nullable column on `lesson_slots` into this ledger.
- **REMOVED**: `lesson_slots.package_purchase_id`.
- **REMOVED**: `package_purchases.count_remaining` mutable counter. Derived from `count_initial - count(non-restored consumptions)`.
- **ADDED** to `package_purchases`: `amount_kopecks`, `currency`, `title_snapshot` (monetary snapshot decoupled from catalog).
- **ADDED**: `UNIQUE (payment_order_id)` on `package_purchases` (DB-enforced one-purchase-per-order).
- **CHANGED**: `expires_at` derived from `payment_orders.paid_at`, not from `package_purchases.created_at`.
- **CHANGED**: `account_id ON DELETE CASCADE` → `RESTRICT`. Account deletion must go through soft-anonymize.
- **ADDED**: DB triggers refusing UPDATE of `amount_kopecks` / `duration_minutes` / `count` on `lesson_packages` and `amount_kopecks` on `pricing_tariffs` once any row references them. App-layer guard becomes belt; DB trigger is suspenders.
- **CHANGED**: Migration of existing slots — predicate-based (`status='booked' AND start_at > $cutover AND learner_account_id IS NOT NULL`), not blanket flag-everything.
- **CHANGED**: Legal-versioning is a **hard prerequisite for prod deploy** of this wave, not an orthogonal sister wave. Without versioned legal evidence, every dispute about "what terms applied to my package purchase / postpaid debt" lacks a defensible answer. Both waves can develop in parallel; billing wave cannot reach prod until legal-versioning lands.
- **TIGHTENED**: postpaid-paid derived state — based on sum of non-reversed allocations matching expected amount, not "any allocation row exists". This wave does not implement reversals (parked refund flow), but the SQL helper that computes paid-state must use the sum-based predicate so that the future refund wave doesn't break the cabinet.
- **TIGHTENED**: `/checkout/?slot=<uuid>` server refuses on slots that are prepaid-consumed (consumption ledger has an unrestored row for the slot). Today this hole would let a learner pay twice for the same lesson.
- **TIGHTENED**: `postpaid_allowed` is read inside the booking transaction with `SELECT ... FOR SHARE` on the `accounts` row, not pre-txn.
- **TIGHTENED**: FIFO consumption uses a per-account `pg_advisory_xact_lock(hashtext('pkg_consume:'||account_id))` so concurrent bookings serialize on the consume path, eliminating the SKIP-LOCKED FIFO drift.
- **TIGHTENED**: 402 `package_required` returns ONLY active packages with matching `duration_minutes` (filtered server-side, not the full catalog).
- **EXPANDED** test matrix: concurrent cancel vs book; double-restore from two actor paths; direct checkout on prepaid slot; webhook duplicate-grant race; FIFO ordering under contention.

## Scope and non-goals

### In scope (this wave)

- New domain entities: `lesson_packages` (catalog), `package_purchases` (per-account, per-purchase), `package_consumptions` (ledger).
- New `accounts.postpaid_allowed` flag.
- Booking flow extended: consume from package → fall back to postpaid (if allowed) → reject (if not allowed AND no package).
- Atomic, race-safe package consumption + restore via the ledger.
- Public surface: new `/checkout/package/[slug]` flow.
- Cabinet UI: "Мои пакеты" section + "К оплате" pill on past unpaid slots.
- Admin UI: `/admin/packages` catalog (CRUD with edit-guard) + per-account postpaid toggle + admin debit view.
- Migration: predicate-based grandfather of existing booked-future slots; `legacy_grandfathered` boolean on `lesson_slots`.
- DB triggers for monetary-field immutability on tariffs and packages.
- `/checkout/?slot=` server-side refusal for prepaid slots.
- Test matrix covering prepay/postpaid/race/expiry/grandfather paths.

### Explicitly out of scope (separate sister waves)

- **Refund flow** — Phase 7 separate task. The wave we're shipping computes paid-state in a way the future refund wave can extend (sum-of-non-reversed); but reversal mechanics, package partial refund, money-back UX are deferred.
- **Late-cancel / no-show auto-debit for postpaid** — operator-handled today; auto-debit policy is a separate decision.
- **Monthly billing aggregator** — separate when volume justifies.
- **Subscription / auto-renew** — explicitly NOT shipping.
- **Cross-tenant package transfer** — packages tied to one `account_id`.
- **Email notifications** for "package expiring soon" / "you have unpaid debt" — flagged in backlog, not in this wave.

### Hard prerequisites (NOT optional)

- **Wave Legal-Versioning** — version IDs on oferta / privacy / pdn-consent, snapshot in DB, history view, link to consent record. Codex round 1 made this a launch blocker (HIGH 6): without versioned evidence, "what terms applied to your purchase" has no answer in a dispute. The two waves can develop in parallel; billing cannot reach prod first.

## Personas and flows

### Persona A: New client (default)

- Lands on `/cabinet`. No active packages. Calendar tab visible.
- Clicks an `open` slot → BookConfirmModal:
  - Learner has no package → modal says "Чтобы записаться, купите пакет" with CTA to `/packages`. Book button disabled.
- Buys "10 × 60 min" via `/checkout/package/10x60min`. Webhook completes → `package_purchases` row inserted with `count_initial=10`, `expires_at = paid_at + 6 months`.
- Returns to calendar. Slot click shows "Списываем 1 урок из пакета (останется ≈9 после записи — точное число подтвердится). Записаться".
- Booking succeeds → `package_consumptions` row inserted, `count_remaining` derived as 9.

### Persona B: Loyal long-term client (postpaid_allowed=true)

- Operator has flipped `accounts.postpaid_allowed=true`.
- Books slot without an active package → modal says "После урока: 3500₽ (постоплата)".
- Booking succeeds → no `package_consumptions` row.
- Lesson runs (`status` becomes `completed`) → cabinet "К оплате" section shows the slot with "Оплатить 3500₽" CTA.
- Click → existing `/checkout/?slot=` flow → webhook writes `payment_allocation` → cabinet pill flips to "оплачено".

### Persona C: Hybrid

- Books with active matching package → consumed (FIFO).
- Books with no matching package (e.g. wrong duration) AND `postpaid_allowed=true` → postpaid debt.
- "К оплате" and "Мои пакеты" coexist independently in the cabinet.

## Domain model

### New: `lesson_packages` (catalog)

```sql
create table lesson_packages (
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
create unique index lesson_packages_slug_idx on lesson_packages (slug);
create index lesson_packages_active_order_idx
  on lesson_packages (display_order, id) where is_active = true;
```

**Trigger: refuse UPDATE of economic fields once a `package_purchases` row references the package.**

```sql
create or replace function lesson_packages_economic_fields_immutable()
returns trigger language plpgsql as $$
begin
  if new.amount_kopecks is distinct from old.amount_kopecks
     or new.duration_minutes is distinct from old.duration_minutes
     or new.count is distinct from old.count
     or new.currency is distinct from old.currency then
    if exists (select 1 from package_purchases where package_id = old.id) then
      raise exception 'lesson_packages: economic fields immutable after first purchase (id=%)', old.id
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;

create trigger lesson_packages_economic_fields_guard
before update on lesson_packages
for each row execute function lesson_packages_economic_fields_immutable();
```

App-layer is the user-facing reject reason; DB trigger is the security boundary.

### New: `package_purchases` (per-account purchase instance)

```sql
create table package_purchases (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete restrict,
  package_id uuid not null references lesson_packages(id) on delete restrict,
  -- DB-enforced one-purchase-per-order. Webhook replays + manual
  -- reprocessing cannot create duplicates.
  payment_order_id text not null unique
    references payment_orders(invoice_id) on delete restrict,
  -- Monetary + descriptive snapshots. Decoupled from lesson_packages
  -- so future catalog changes (in violation of the trigger above
  -- via direct SQL or future code) cannot silently change the
  -- contract on existing learners. Cabinet "Мои пакеты" reads
  -- title_snapshot, not lesson_packages.title_ru.
  amount_kopecks integer not null check (amount_kopecks between 100 and 100000000),
  currency text not null default 'RUB' check (currency = 'RUB'),
  title_snapshot text not null,
  duration_minutes integer not null check (duration_minutes between 15 and 180),
  count_initial integer not null check (count_initial > 0 and count_initial <= 100),
  -- expires_at = payment_orders.paid_at + 6 months, computed at
  -- insert time (single source of truth); fixed thereafter, no
  -- extension.
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index package_purchases_account_active_idx
  on package_purchases (account_id, duration_minutes, expires_at, id);
-- payment_order_id UNIQUE constraint above already creates the index.
```

`count_remaining` is **not stored**. Derived per-query as `count_initial - (select count(*) from package_consumptions where package_purchase_id = pp.id and restored_at is null)`. For 10-unit packages with maybe 10-20 events ever, the count is cheap; no cache needed and no reconciliation drift.

`account_id ON DELETE RESTRICT`: account deletion must go through soft-anonymize (existing infrastructure). A monetary obligation cannot be silently severed.

The composite index supports the hot booking path "find earliest-expiring matching package for this account". Expiry filter lives in the query (`expires_at > now()`); we don't try to bake `now()` into a partial index — Postgres won't accept volatile functions there.

### New: `package_consumptions` (immutable ledger)

```sql
create table package_consumptions (
  -- Immutable ledger. slot_id is the PK, so a slot can have at most
  -- one consumption row in its lifetime. Cancellation stamps the
  -- restored_at column on the same row; the unit returns to the
  -- package, but the row stays for audit. There is no path that
  -- creates a second consumption row for the same slot.
  slot_id uuid not null primary key
    references lesson_slots(id) on delete restrict,
  package_purchase_id uuid not null
    references package_purchases(id) on delete restrict,
  consumed_at timestamptz not null default now(),
  consumed_by_actor text not null
    check (consumed_by_actor in ('learner', 'admin', 'teacher')),
  -- Restore stamp. Null = active consumption (counts against
  -- count_remaining). Non-null = unit returned to package; does
  -- not count.
  restored_at timestamptz,
  restored_by_actor text
    check (restored_by_actor is null or restored_by_actor in ('learner', 'admin', 'teacher')),
  restored_reason text,
  -- The active count derivation joins on this; index supports the
  -- hot path "how many units of THIS purchase are still consumed".
  constraint package_consumptions_restore_pair_check
    check ((restored_at is null) = (restored_by_actor is null))
);
create index package_consumptions_purchase_active_idx
  on package_consumptions (package_purchase_id) where restored_at is null;
```

`slot_id PRIMARY KEY` is the security boundary. A second concurrent consumption attempt on the same slot returns conflict (23505 unique violation), preventing double-charge.

`on delete restrict` on slot_id — slot rows live forever (existing convention); this just makes it explicit.

**One-shot consumption per slot.** A slot can have at most one consumption row in its lifetime. Cancellation stamps `restored_at` (the row stays as audit), so the unit returns to the package, but the row remains. Re-opening a cancelled slot is not a supported operator flow; if it becomes one, the second consumption attempt will conflict on the PK and the operator will need to use a new slot. This is an explicit design choice — the consumption ledger trades "ability to re-bind a cancelled slot to a new package consumption" for unconditional double-charge protection.

### New column: `accounts.postpaid_allowed`

```sql
alter table accounts
  add column if not exists postpaid_allowed boolean not null default false;
```

### New column: `lesson_slots.legacy_grandfathered`

```sql
alter table lesson_slots
  add column if not exists legacy_grandfathered boolean not null default false;
```

Backfill in the same migration. **Predicate uses a literal cutover timestamp, not `now()`** — see "Predicate-based grandfathering with a literal cutover" below for the exact form. Only future-booked rows (relative to the literal) with a learner are grandfathered. Past completed/cancelled rows stay `false` — they're history, not pending obligations.

Operators are expected to **pre-flip `postpaid_allowed=true` for trusted accounts BEFORE running the migration**. The runbook (below) generates a candidate list for review.

### Extension: `payment_allocations.kind` enum

```sql
alter table payment_allocations
  drop constraint payment_allocations_kind_check,
  add constraint payment_allocations_kind_check
    check (kind in ('lesson_slot', 'package'));
```

When a learner pays for a package, the allocation row carries `kind='package'`, `target_id=package_purchases.id`, `amount_kopecks=full purchase price`.

### Retroactive: `pricing_tariffs.amount_kopecks` immutability trigger

Same pattern as `lesson_packages` trigger. App-side `updateTariff` already exists and today permits `amount_kopecks` edits. The DB trigger refuses if any `lesson_slots.tariff_id` references this row. App-layer guard updated to surface the friendly UI error before the trigger fires.

```sql
create or replace function pricing_tariffs_amount_immutable()
returns trigger language plpgsql as $$
begin
  if new.amount_kopecks is distinct from old.amount_kopecks then
    if exists (select 1 from lesson_slots where tariff_id = old.id) then
      raise exception 'pricing_tariffs: amount_kopecks immutable after first slot reference (id=%)', old.id
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;

create trigger pricing_tariffs_amount_guard
before update on pricing_tariffs
for each row execute function pricing_tariffs_amount_immutable();
```

## Booking semantics

The new `bookSlot` flow is one transaction:

```
BEGIN;

-- Step 0: lock the account row to read postpaid_allowed live.
-- FOR SHARE prevents an operator UPDATE of the flag mid-booking
-- without preventing other read-only queries.
SELECT postpaid_allowed
  FROM accounts
 WHERE id = $learner
 FOR SHARE
 INTO $allowed;

-- Step 1: take a per-account advisory lock so concurrent bookings
-- by the SAME learner serialize on the consumption decision. This
-- gives strict FIFO over packages and rules out two concurrent
-- decrements both grabbing the last unit of one package.
SELECT pg_advisory_xact_lock(hashtext('pkg_consume:' || $learner));

-- Step 2: atomic slot reservation (existing pattern).
UPDATE lesson_slots
   SET status = 'booked',
       learner_account_id = $learner,
       booked_at = now(),
       updated_at = now(),
       events = $event_jsonb || events
 WHERE id = $slot
   AND status = 'open'
   AND start_at > now()
   AND teacher_account_id <> $learner
RETURNING id, duration_minutes, tariff_id;

-- if 0 rows → ROLLBACK; return existing failure shape.

-- Step 3: try to find a matching package and consume one unit.
WITH eligible AS (
  SELECT pp.id
    FROM package_purchases pp
   WHERE pp.account_id = $learner
     AND pp.duration_minutes = $slot.duration_minutes
     AND pp.expires_at > now()
     AND pp.count_initial - (
           select count(*) from package_consumptions pc
            where pc.package_purchase_id = pp.id
              and pc.restored_at is null
         ) > 0
   ORDER BY pp.expires_at ASC, pp.id
   LIMIT 1
   FOR UPDATE OF pp
)
INSERT INTO package_consumptions (slot_id, package_purchase_id, consumed_by_actor)
SELECT $slot, eligible.id, $actor
  FROM eligible
ON CONFLICT (slot_id) DO NOTHING
RETURNING package_purchase_id;

-- if 1 row inserted → prepaid; commit, return billing.kind='prepaid'.
-- if 0 rows inserted because eligible was empty:

-- Step 4: pending-package gate. If the learner has a recent pending
-- CloudPayments order for a package matching this slot's duration,
-- block postpaid fallback and tell them to wait. This closes the
-- "pay-package-then-quickly-book" race that would otherwise put a
-- slot into postpaid debt while a paid grant is in-flight.
SELECT 1
  FROM payment_orders
 WHERE metadata->>'accountId' = $learner::text
   AND metadata->>'packageSlug' IS NOT NULL
   AND metadata->>'packageDurationMinutes' = $slot.duration_minutes::text
   AND status IN ('pending', '3ds_required')
   AND created_at > now() - interval '15 minutes'
 LIMIT 1
 INTO $pending;
-- if $pending → ROLLBACK; return 409 pending_package_grant
-- with message "У вас оформляется пакет — подождите 1 минуту и обновите."

-- Step 5: postpaid eligibility.
-- if $allowed AND slot.tariff_id is not null:
--   commit; return billing.kind='postpaid', amount_kopecks=tariff.amount_kopecks.
-- if $allowed AND slot.tariff_id is null:
--   ROLLBACK; return 402 tariff_required.
-- if NOT $allowed:
--   ROLLBACK; return 402 package_required + filtered package list.

COMMIT;
```

The pending-package metadata fields (`accountId`, `packageSlug`, `packageDurationMinutes`) are written to `payment_orders.metadata` at checkout-package init time (PR 2). Without them the gate is a no-op — order is invisible to the predicate, no false blocks. With them, a learner who pays for a 60-min package and immediately tries to book a 60-min slot is gated until the webhook materializes the package. The 15-minute window is generous; CloudPayments typically delivers `pay.processed` within 5–30 seconds.

### Race-safety pinning

- **Slot reservation**: existing pattern + migration 0031. One winner per slot.
- **Per-account advisory lock**: serializes booking decisions for the same learner. Cost: cross-learner concurrency unchanged; same-learner concurrency capped at 1. Acceptable: no realistic scenario of one learner booking two slots at literally the same instant.
- **Consumption insert with `ON CONFLICT (slot_id) DO NOTHING`**: even if the advisory lock is bypassed somehow, the slot_id PK refuses the second consumption.
- **`FOR UPDATE OF pp`**: locks the candidate purchase row so a parallel restore (cancellation) on the same purchase doesn't shift the `count_remaining` derivation underneath us.
- **`postpaid_allowed` read with `FOR SHARE`**: refuses concurrent operator UPDATE of the flag. Two readers can both pass; an operator UPDATE waits.

### Failure shapes (route-level)

```
200 — booking succeeded
  body: { slot, billing: { kind: 'prepaid', package_purchase_id, count_remaining_after, expires_at } }
  body: { slot, billing: { kind: 'postpaid', tariff_id, amount_kopecks, currency } }

402 Payment Required — no package, postpaid not allowed
  body: { error: 'package_required',
          message: 'Чтобы записаться, купите пакет уроков.',
          available_packages: [...]   ← filtered: is_active AND duration_minutes = slot.duration_minutes;
                                      ← capped at top-3 by display_order
        }

402 Payment Required — postpaid path, slot has no tariff
  body: { error: 'tariff_required', message: 'У этого слота не указана цена.' }

409 Conflict — package grant in flight
  body: { error: 'pending_package_grant',
          message: 'У вас оформляется пакет — подождите минуту и обновите.' }

409 — existing flows (not_open / in_past / self_booking_blocked)
401 / 403 — existing auth gates
```

`available_packages` filtered to **active + matching duration only**. The `/packages` page is public; we are not leaking anything new, but a hostile UI consumer should not get the entire catalog from an error response.

## Cancellation semantics

### Restore is an UPDATE, not an INSERT/DELETE

```sql
UPDATE package_consumptions
   SET restored_at = now(),
       restored_by_actor = $actor,
       restored_reason = $reason
 WHERE slot_id = $1 AND restored_at is null
RETURNING package_purchase_id;
```

Idempotent: if `restored_at` is already non-null, the UPDATE matches 0 rows and the call is a no-op. Two concurrent cancel paths (e.g. learner cancels just as admin cancels) cannot both restore — the WHERE clause is the boundary.

### Learner cancels prepaid future slot, ≥24h before start

Existing `cancelLearnerSlot` runs first (atomic UPDATE on lesson_slots with status='booked' AND 24h gate). On success, **the same transaction** restores the consumption: `UPDATE package_consumptions SET restored_at=now(), ... WHERE slot_id=$slot AND restored_at IS NULL`. If 0 rows → no consumption to restore (postpaid path). If 1 row → unit logically restored.

### Learner cancels prepaid future slot, <24h

Existing 24h gate refuses (`too_late_to_cancel`). No consumption change. Operator override (admin path) restores.

### Operator cancels (admin)

`cancelSlot` admin path runs the consumption-restore in the same transaction. If the slot was prepaid, restore stamps. If postpaid, no-op.

### Teacher cancels (Wave C)

`cancelSlotByTeacher` runs the same restore. Reason still required for booked slots (existing).

### `/checkout/?slot=<uuid>` server refusal for prepaid slots

Today `/checkout/?slot=<uuid>` is happy to take money for any slot. With prepaid-consumed slots in the picture, the server must refuse:

```
GET /checkout/[tariffSlug]?slot=<uuid>
  Server-side: SELECT 1 FROM package_consumptions
                WHERE slot_id = $slot AND restored_at is null;
  If found:
    redirect to /cabinet with toast "Этот слот уже оплачен через пакет."
```

The same check happens at the `POST /api/payments` level for any slot-bound checkout, so a programmatic caller cannot pay twice.

### Postpaid-paid derived state

```sql
-- A slot is "postpaid-paid" iff: sum of allocation amounts attached
-- to PAID orders >= expected tariff amount.
-- Codex round 2 HIGH 1: the LEFT JOIN on payment_orders MUST filter
-- the SUM by `o.invoice_id IS NOT NULL` (i.e. row joined as paid),
-- otherwise allocations attached to pending/failed/cancelled orders
-- pollute the total. The CASE expression below is the load-bearing
-- predicate.
SELECT
  s.id as slot_id,
  s.tariff_id,
  t.amount_kopecks as expected_amount_kopecks,
  COALESCE(SUM(
    CASE WHEN o.invoice_id IS NOT NULL
         THEN a.amount_kopecks
         ELSE 0
    END
  ), 0) as paid_amount_kopecks
FROM lesson_slots s
LEFT JOIN pricing_tariffs t ON t.id = s.tariff_id
LEFT JOIN payment_allocations a
       ON a.kind = 'lesson_slot' AND a.target_id = s.id
LEFT JOIN payment_orders o
       ON o.invoice_id = a.payment_order_id AND o.status = 'paid'
WHERE s.id = $1
GROUP BY s.id, t.amount_kopecks;
-- Definition: paid IFF paid_amount_kopecks >= expected_amount_kopecks
-- AND there is no allocation reversal row (when refund flow lands).
```

This derivation is implemented in a `lib/billing/paid-state.ts` helper. The cabinet "К оплате" pill calls this helper. Refund wave shipped 2026-05-11 (Waves 50-54): the helper now does a LATERAL `SUM(refunded_kopecks)` against `payment_allocation_reversals` and treats an allocation as fully contributing while `SUM < amount_kopecks` (binary all-or-nothing — partial refunds keep the slot in the paid bucket).

### Re-opening a cancelled prepaid slot

Out of scope. Today there is no re-open flow. Operators cancel + create a new slot. The consumption ledger PK on `slot_id` would refuse a second consumption attempt for the same slot anyway.

## TTL semantics

`package_purchases.expires_at = payment_orders.paid_at + interval '6 months'`. Computed at insert time:

```sql
INSERT INTO package_purchases (
  ..., expires_at
) SELECT
  ...,
  o.paid_at + interval '6 months'
FROM payment_orders o
WHERE o.invoice_id = $payment_order_id;
```

Fixed, no extension. Email notifications (out of scope here): T-30, T-7, T-1.

Cabinet "Мои пакеты" shows the package as expired with grayed status if `expires_at <= now()` AND the package still has consumable count derivation. No CTA.

## Migration of existing data

### Predicate-based grandfathering with a literal cutover

```sql
-- Backfill in the migration transaction.
-- Codex round 2 MEDIUM 3: cutover timestamp is a literal baked
-- into the migration file at creation time, NOT now(). This makes
-- replays on dev / staging / replay branches deterministic — the
-- same set of rows always grandfathers regardless of when the
-- migration runs.
update lesson_slots
   set legacy_grandfathered = true
 where status = 'booked'
   and start_at > '2026-05-09T00:00:00Z'::timestamptz   -- BAKE AT MIGRATION CREATION TIME
   and learner_account_id is not null;
```

Only future-booked rows (relative to the cutover) are grandfathered. Past rows stay `false` — they are history, not pending obligations. **The exact ISO literal is set when this migration is committed, not at the time it executes.**

### Pre-flight runbook

```sql
-- Before applying the migration, run this read-only report:
select a.id, a.email, count(*) as booked_future_slots,
       sum(coalesce(t.amount_kopecks, 0))::bigint as estimated_obligation_kopecks
  from accounts a
  join lesson_slots s on s.learner_account_id = a.id
  left join pricing_tariffs t on t.id = s.tariff_id
 where s.status = 'booked' and s.start_at > now()
 group by a.id, a.email
 order by booked_future_slots desc;
```

Operator reviews the list. For accounts that should keep operator-trust postpaid behavior (loyal long-term clients), the operator runs:

```sql
update accounts set postpaid_allowed = true where id = $account_id;
```

before the migration. The migration runs identically; `legacy_grandfathered` still gets set (it's about already-booked slots, not the postpaid policy), but the cabinet UI for these accounts shows the normal postpaid CTA, not the legacy hint.

### Rollback path

The migration is reversible:

```sql
-- forward
alter table accounts add column postpaid_allowed boolean not null default false;
alter table lesson_slots add column legacy_grandfathered boolean not null default false;
update lesson_slots set legacy_grandfathered = true where ...;

-- backward (in the case of rollback before any package_purchases / package_consumptions exist)
alter table lesson_slots drop column legacy_grandfathered;
alter table accounts drop column postpaid_allowed;
-- New tables: drop in reverse order.
drop table package_consumptions;
drop table package_purchases;
drop table lesson_packages;
drop trigger ...;
drop function ...;
```

After the wave ships and any `package_purchases` rows exist, rollback requires data preservation — full backup + manual reconciliation. The runbook below names this point-of-no-return.

## UI surface

(Same as v1 with these clarifications:)

- "Мои пакеты" reads `title_snapshot` and computed `count_remaining`, never `lesson_packages.title_ru`. Catalog edits do not retroactively rename historical purchases.
- BookConfirmModal billing-preview is **client-side derived** from a separate `/api/account/packages` call (own active list) plus the slot's `duration_minutes` from the calendar DTO. No new server-side billing-context endpoint. **The preview count is advisory**: the modal copy reads "Останется ≈9 после записи (точное число — после подтверждения)" so two-device concurrency cannot mislead the learner. The booking response from the API carries the authoritative `count_remaining_after`.
- Admin `/admin/packages` UI shows a "Цена и длительность зафиксированы" warning chip when references exist, and disables the edit affordance for those fields. The DB trigger is the safety net.

## Auth invariants

(Unchanged from v1.)

## Test matrix (expanded)

### Unit / data-layer

- `consumePackageUnit` happy path.
- Race: 10 concurrent calls for same `account_id` against a 5-unit package → exactly 5 succeed, 5 conflict on consumption PK.
- Race: 2 concurrent cancels on the same prepaid slot → exactly one restore stamps; the other no-ops.
- Race: cancel-then-book in opposite orders → consumption PK refuses second attempt (slot is now `cancelled`, not bookable).
- Race: concurrent restore + new consumption on the SAME purchase → derived count_remaining stays correct.
- FIFO under contention: two purchases, earlier expiring → drained first.
- Expired packages skipped (`expires_at <= now()`).
- Wrong-duration packages skipped.

### Integration (route-level, real Postgres)

#### Booking

- Anonymous → 401.
- Unverified learner → 403.
- Active matching package → 200 prepaid; consumption row inserted.
- No package, `postpaid_allowed=false` → 402 `package_required`. `available_packages` filtered to matching duration + active, capped at top-3 by `display_order`.
- No package, `postpaid_allowed=true`, slot has tariff → 200 postpaid.
- No package, `postpaid_allowed=true`, slot has NO tariff → 402 `tariff_required`.
- Expired package + `postpaid_allowed=false` → 402.
- Expired package + `postpaid_allowed=true` → 200 postpaid (expired package ignored).
- Hybrid wrong-duration + `postpaid_allowed=true` → 200 postpaid (package unconsumed).
- Race: two POSTs to the same slot → one wins, other 409.
- Race: same learner two POSTs to two different slots, 1-unit package → exactly one prepaid, the other 402 OR postpaid.
- Race: webhook duplicate processing of the same paid order → exactly one `package_purchases` row (UNIQUE on payment_order_id) AND exactly one `payment_allocations` row (composite PK on `(payment_order_id, kind, target_id)`).
- Race: pending-package-then-book — at T0 learner initiates `/checkout/package/10x60min`; before webhook fires, learner POSTs `/api/slots/[id]/book` for a 60-min slot with `postpaid_allowed=true`. Expected: 409 `pending_package_grant`. After webhook completes (simulate by direct UPDATE to `paid` + insert into `package_purchases`), repeat → 200 prepaid.
- Race: pending-package-then-book mismatched duration — same setup with 60-min pending package but a 90-min slot. Expected: postpaid path applies (the gate checks `packageDurationMinutes` matches slot duration).

#### Cancellation + restore

- Learner cancel ≥24h on prepaid future slot → consumption restored.
- Learner cancel <24h → `too_late_to_cancel`; no restore.
- Admin cancel → restore.
- Teacher cancel → restore.
- Race: learner + admin both cancel same prepaid slot → exactly one restore stamps.
- Postpaid future slot cancel → no consumption change.
- Double-cancel idempotence: second cancel on already-cancelled slot returns existing `already_terminal`; consumption restore still no-ops.

#### Direct-checkout refusal

- POST `/api/payments` with `slotId` of a prepaid-consumed slot → 409 conflict, `error: 'slot_already_paid_via_package'`.
- Same with restored consumption (cancelled prepaid) → 200 (slot is now postpaid-eligible).

#### Edit-guard

- Tariff with referenced slots → in-place `amount_kopecks` edit refused at app layer AND DB trigger. Soft-archive (`is_active=false`) allowed.
- Package with no purchases → all edits allowed.
- Package with purchases → economic fields refused; `slug` / `title_ru` / `description_ru` / `is_active` / `display_order` allowed.

#### Webhook

- Pay processed for package order → `package_purchases` row inserted with snapshot fields, `expires_at` from order's `paid_at`, `payment_allocations` row with `kind='package'`.
- Replay → idempotent (UNIQUE on payment_order_id).
- Concurrent webhook deliveries → exactly one purchase (UNIQUE).

#### Migration

- Pre-migration row count of `lesson_slots` matches post.
- Predicate-backfilled rows: future-booked-with-learner have `legacy_grandfathered=true`. Past or open slots have `false`.
- Operator pre-flag: account with `postpaid_allowed=true` set BEFORE migration → its booked-future slots also get `legacy_grandfathered=true` (the flag is independent), but cabinet behaviour for the account differs.

## PR phasing

### PR 1 — backend foundation + migrations

- Migration: `lesson_packages`, `package_purchases`, `package_consumptions`, `accounts.postpaid_allowed`, `lesson_slots.legacy_grandfathered`, `payment_allocations.kind` widening, all triggers (lesson_packages, pricing_tariffs amount_immutable), predicate-based grandfather backfill.
- Data layer: `lib/billing/packages.ts` — `createPackagePurchase`, `consumePackageUnit`, `restorePackageConsumption`, `listAccountActivePackages`, `listAccountPostpaidDebt`, `derivePackageRemaining`.
- `lib/billing/paid-state.ts` — `slotIsPaidByAllocations` (sum-based).
- `bookSlot` rewired with billing flow + 402 paths + advisory lock.
- All cancel paths (`cancelLearnerSlot`, `cancelSlot` admin, `cancelSlotByTeacher`) wired to consumption restore.
- `/api/payments` slot-bound checkout refuses prepaid-consumed slots.
- `updateTariff` app-side edit-guard.
- All tests pinned in this PR.

**Estimate:** ~7-8h.

### PR 2 — public surface

- `GET /api/account/packages` (own active + recently-expired list).
- `POST /checkout/package/[slug]` page + form.
- Webhook handler `cloudpayments-route.ts` — `package` branch on `pay.processed`. Single tx: insert `package_purchases` (UNIQUE on payment_order_id) with `expires_at = order.paid_at + interval '6 months'` + `payment_allocations` (kind='package', target_id=package_purchases.id, idempotent on composite PK).
- Tests: webhook integration, replay idempotence, package-checkout 402 paths, pending-package gate (booking returns 409 while order pending; 200 prepaid after webhook completes), trust-boundary (client-supplied `accountId` in checkout body is rejected / ignored — only session-derived id wins).

**Trust boundary on `payment_orders.metadata` (Codex round 3 HIGH + round 5 HIGH)**

Every field that the booking gate or webhook reads MUST be server-authored at checkout-init time. Never copied from the client request body, query string, form field, or any caller-controllable input:

| Field | Source | Rationale |
|---|---|---|
| `metadata.accountId` | `requireAuthenticatedAndVerified(request).account.id` | Forge-vector: a client-supplied `accountId` would let a hostile user gate-spoof or grant-redirect. |
| `metadata.packageSlug` | URL path `:slug` resolved against `lesson_packages` (active + by slug). 404 if unknown. | Slug is the user-visible identifier; the resolved row is the source of truth. |
| `metadata.packageDurationMinutes` | `lesson_packages.duration_minutes` from the resolved row | Never trust client duration. |
| `customer_email` (plaintext in tx, ciphertext in row) | `accounts.email` from the authenticated session — looked up via session id, never read from request input | This is THE authoritative ownership token at webhook time. Must not be client-influenceable. |

The webhook handler does NOT use `metadata.accountId` as the authoritative ownership token — it uses `payment_orders.customer_email_enc` (decrypted via the audit-encryption key) matched to an `accounts.email_normalized`. The metadata fields are a lookup hint and a gate predicate input, not the security boundary.

**Webhook ownership contract** (Codex rounds 4 + 5):

1. **Mandatory ciphertext at order init from session-derived plaintext.** `POST /api/payments` for a package order MUST go through the existing `createPayment(...)` writer, which already writes `customer_email_enc` from `customer_email` via `encryptViaAuditKey()`. The plaintext `customer_email` MUST be `accounts.email` from the authenticated session (session id → DB lookup → email), NOT from the request body. The package-checkout flow does NOT introduce a new payment-order writer. If the existing writer is bypassed, the webhook fails closed (see (4)).

2. **Dual-source ownership resolution.** Webhook resolves the owner via TWO independent paths and requires agreement:

   ```ts
   // Path A: server-authored metadata.accountId
   const metaAccountId = order.metadata?.accountId
   if (typeof metaAccountId !== 'string') {
     fail_closed_semantic('no_metadata_accountid')
     return
   }
   const metaAccount = await query(
     'SELECT id FROM accounts WHERE id = $1', [metaAccountId])
   if (metaAccount.length === 0) {
     fail_closed_semantic('metadata_accountid_unknown')
     return
   }

   // Path B: customer_email_enc decrypt-and-match
   const ciphertext = order.customer_email_enc
   if (!ciphertext) {
     fail_closed_semantic('no_ciphertext')
     return
   }
   let plaintext: string
   try {
     plaintext = decryptViaAuditKey(ciphertext)
   } catch (e) {
     fail_closed_semantic('decrypt_failed')
     return
   }
   const normalized = plaintext.trim().toLowerCase()
   const emailAccounts = await query(
     'SELECT id FROM accounts WHERE email_normalized = $1', [normalized])
   if (emailAccounts.length === 0) {
     fail_closed_semantic('no_account_match')
     return
   }
   if (emailAccounts.length > 1) {
     fail_closed_semantic('multi_account_match')
     return
   }

   // Corroboration: both paths MUST resolve to the same account.
   if (metaAccount[0].id !== emailAccounts[0].id) {
     fail_closed_semantic('metadata_email_mismatch')
     return
   }

   const accountId = metaAccount[0].id
   ```

   `email_normalized` is populated by migration 0010, the same column the auth flow uses. The same `trim().toLowerCase()` normalization. Both resolutions go through `accounts` rows that exist server-side; neither path lets the client influence the result.

3. **Permanent semantic failures vs transient operational failures (Codex round 5 MEDIUM):**

   - `fail_closed_semantic(reason)` is for the SEVEN well-defined ownership failures: `no_metadata_accountid`, `metadata_accountid_unknown`, `no_ciphertext`, `decrypt_failed`, `no_account_match`, `multi_account_match`, `metadata_email_mismatch`. These are PERMANENT — a CloudPayments retry would resolve to the same outcome. The handler writes `payment.grant.failed/<reason>` audit event and **returns HTTP 200** so CloudPayments stops retrying. The package-grant simply does not happen automatically; operator follow-up via `/admin/payments` audit log.

   - **Transient operational failures** — DB outage, transaction abort, deadlock, audit-event insert failure, allocation insert failure, unhandled exception — must NOT use `fail_closed_semantic`. They throw, the route returns 5xx (or rethrows the exception which the framework converts to 500), and CloudPayments retries the webhook. This is the difference between "money paid, package permanently un-grantable for a code reason" (which should generate an operator alert + manual review, but never silently loop) and "money paid, package not granted yet because Postgres was down for 3 seconds" (which retries naturally).

4. **Operator visibility.** `/admin/payments` shows `package.grant.failed/<reason>` audit events with full context. Operator sees "this order paid but couldn't be granted — manual investigation required". The learner's money is safe (CloudPayments holds it; refund is operator-discretion). For benign drifts (e.g. user changed email between checkout and webhook → `metadata_email_mismatch`), the operator is the human who reconciles.

**Account-lifecycle policy during in-flight package grant** (Codex round 6 MEDIUM):

The corroboration model is fail-closed if the underlying account state mutates between `/checkout/package/[slug]` init and the eventual `pay.processed` webhook. To minimize the surface for benign mutations:

| Mutation | Policy |
|---|---|
| Account anonymize / scheduled-delete | **Refused** while ANY in-flight package grant exists for the account. The existing `account_deletion_grace` (migration 0019) flow is extended at BOTH steps. (1) `requestAccountDeletion()` checks the predicate before recording the schedule. (2) The cron-side anonymizer re-checks the predicate before executing — covers the gap where a pending order arrived AFTER scheduling but BEFORE the grace period elapsed. **The canonical predicate has TWO branches** (Codex round 8 MEDIUM closes the paid-not-granted gap):<br><br>**Branch A** — pending-and-not-yet-paid:<br>`EXISTS (SELECT 1 FROM payment_orders WHERE metadata->>'accountId' = $accountId AND metadata->>'packageSlug' IS NOT NULL AND status IN ('pending', '3ds_required') AND created_at > now() - interval '15 minutes')`<br><br>**Branch B** — paid-but-grant-not-materialized:<br>`EXISTS (SELECT 1 FROM payment_orders po WHERE po.metadata->>'accountId' = $accountId AND po.metadata->>'packageSlug' IS NOT NULL AND po.status = 'paid' AND NOT EXISTS (SELECT 1 FROM package_purchases pp WHERE pp.payment_order_id = po.invoice_id))`<br><br>Branch B has NO 15-minute bound — a paid order that hasn't been granted is a money-already-captured case and deserves an indefinite block until the operator reconciles. Branch A is bounded because pending orders can stick (network failures, abandoned 3DS); the existing 60-min janitor (`cancel-stale-orders.mjs`) auto-cancels them, after which they no longer match the predicate.<br><br>If either branch matches, the deletion request is rejected with "есть незавершённая покупка пакета — попробуйте через 15 минут или обратитесь к оператору". |
| Account merge | **Not a feature today.** Documented as not supported. If/when merge is implemented, the merge logic must scan for in-flight package orders and migrate them explicitly. |
| Account email change | Allowed. If the change happens during the 15-min pending window, the webhook may resolve to `no_account_match` or `metadata_email_mismatch` and fail-closed → operator manual reconciliation. The edge is bounded; this is the existing fail-closed posture. |
| Operator-initiated account state change (suspend, etc.) | Same as anonymize — refused while pending package order exists. |

The deletion-blocking guard is implemented at TWO points: (1) `app/api/account/delete/route.ts` (the route that calls `requestAccountDeletion()` after gating on the predicate) and (2) the cron-side anonymizer in `scripts/db-retention-cleanup.mjs`. Both branches A and B live in `accountHasInFlightPackageGrant(accountId)` (canonical helper at `lib/billing/deletion-guard.ts`); the cron-side `.mjs` script can't import TS so it inlines the same SQL with a comment pointing back to the helper as the source of truth — both copies must stay in sync. Schedule-step refusal returns `409 { error: 'in_flight_package_grant', reason: 'pending_within_15min' | 'paid_not_granted' }`. **Wave 13 dead-code sweep deleted an earlier helper that had never been wired; Wave 59 (2026-05-12) re-introduces the canonical helper and wires both call sites for the first time, restoring this design contract.** Integration coverage: (a) schedule blocked when Branch A matches (pending order < 15 min); (b) schedule allowed when pending order is older than 15 minutes (Branch A stale); (c) schedule allowed with no pending order and no paid-not-granted; (d) execute blocked when pending order arrives between schedule and cron-fire (Branch A re-check at execute) — covered by the script's per-row re-check; (e) execute allowed when pending order resolved (paid AND granted) by cron-fire time; (f) **schedule blocked when Branch B matches** (paid order without `package_purchases` row); (g) execute blocked when Branch B matches at execute time (webhook still mid-retry). Branch B has no time bound — paid-not-granted is an indefinite block until operator reconciles via `/admin/payments`.

This contract is verified in five integration tests in PR 2:
- (a) Checkout init with `accountId` in the request body that differs from the session — body field silently ignored.
- (b) Checkout init with `customer_email` in the request body that differs from the session's account email — body field silently ignored, session value used.
- (c) Webhook with tampered `metadata.accountId` (does not match email-resolved account) → `metadata_email_mismatch` semantic fail-closed.
- (d) Six remaining fail-closed semantic sub-cases — `no_metadata_accountid`, `metadata_accountid_unknown`, `no_ciphertext`, `decrypt_failed`, `no_account_match`, `multi_account_match`. Combined with (c), all seven semantic reasons are covered.
- (e) Operational failure path — simulate a DB error mid-grant; webhook returns 5xx; subsequent retry succeeds. Verifies the handler does NOT swallow operational failures as semantic.

**Estimate:** ~4-5h.

### PR 3 — cabinet UI

- "Мои пакеты" section.
- "К оплате" section.
- BookConfirmModal billing-preview branches.

**Estimate:** ~4h.

### PR 4 — admin UI

- `/admin/packages` catalog (CRUD with edit-guard).
- `/admin/accounts/[id]` postpaid toggle + active packages widget + debt widget.
- `/admin/debt` (or `/admin/payments` extension).
- `/admin/pricing` retroactive edit-guard.

**Estimate:** ~5h.

### PR 5 — legal pipeline

- Update oferta §5 and §8 to reference packages, postpaid, TTL.
- Run through `legal-rf-router → private-client → qa`.
- **This PR cannot ship to prod until the Wave Legal-Versioning lands** (Codex round 1 HIGH 6: prerequisite, not orthogonal).

**Estimate:** ~2h drafting + legal loop.

## Migration runbook (PR 1 deploy day)

### Phase 0 — pre-flight (T-2 days)

1. Run the pre-flight report. Operator reviews booked-future-slot list per account, decides who gets `postpaid_allowed=true`.
2. Operator runs `update accounts set postpaid_allowed=true where id in (...)` for the chosen subset.
3. Re-run the pre-flight report; confirm the postpaid_allowed column reflects choices.

### Phase 1 — feature-flag deploy (T-1 day)

1. Migration applied with feature flag `BILLING_WAVE_ACTIVE=false` initially. New tables exist but `bookSlot` still routes through legacy path.
2. Smoke: existing booking flow works as before; new tables are present and empty.

**Feature flag mechanics** (Codex round 2 MEDIUM 1): the backend reads `process.env.BILLING_WAVE_ACTIVE` (string === `'true'`) once at process start. **Flipping the flag requires a service restart.** LevelChannel today runs as a single VPS-side `levelchannel.service` (no multi-instance coordination needed). The flag is set in `/etc/levelchannel/env` (operator-side, kept out of the repo); deploy runbook owns the flip.

**Test/integration behavior** (Codex round 3 MEDIUM): integration tests in `tests/integration/` boot the app with `BILLING_WAVE_ACTIVE=true` so the route-level matrix exercises the new path. `scripts/test-integration.sh` exports the flag as part of the env it passes to vitest. Pure data-layer unit tests in `tests/billing/` test functions directly (`consumePackageUnit`, `restorePackageConsumption`, `slotIsPaidByAllocations`) and are flag-independent. PR 1 wires the env-export.

**Legacy fast-path response shape** (Codex Wave 12 sweep MEDIUM 1, 2026-05-11): when `BILLING_WAVE_ACTIVE !== 'true'`, the SQL path in `bookSlot` is preserved bit-for-bit, but the route response gained an additive `billing: { kind: 'legacy' }` field. This is intentional and **NOT** a contract regression — callers that ignore the field (all current legacy clients) behave identically, and the flag-on branch now has a typed surface to distinguish prepaid / postpaid / legacy. The Wave 12 post-merge sweep documented this so audit reads aren't confused by the new field appearing in flag-off rows.

### Phase 2 — flip the flag (T-0)

1. Operator sets `BILLING_WAVE_ACTIVE=true` in `/etc/levelchannel/env` and runs `systemctl restart levelchannel`. Booking flow re-routes through the new path.
2. Smoke: book a test slot as a postpaid-allowed account → 200 postpaid. Book as default account → 402 (no package). Buy a test package → book → 200 prepaid. Cancel → consumption restored.
3. Watch dashboards: 402 rate on `/api/slots/[id]/book`. If high (>1% of bookings), revert flag (`BILLING_WAVE_ACTIVE=false` + restart) and investigate (likely a missed `postpaid_allowed` flip).

### Phase 3 — point-of-no-return

After the first real `package_purchases` row exists, full rollback requires backup restoration. The runbook explicitly names this. Forward-fix only.

## Open questions / decisions log

| # | Question | Status |
|---|---|---|
| 1 | Two containers vs single ledger | Decided — two containers |
| 2 | Postpaid by default or by-permission | Decided — admin flag, default false |
| 3 | TTL: extension vs fixed | Decided — fixed 6 months from `paid_at` |
| 4 | Refund flow | Parked, separate sister-wave |
| 5 | Pricing snapshot mechanism | Decided — FK + DB trigger immutability + monetary snapshot on `package_purchases` |
| 6 | Legal-versioning | Decided — hard prerequisite (Codex round 1 HIGH 6) |
| 7 | Existing slot migration | Decided — predicate-based grandfather, operator pre-flips postpaid for trusted |
| 8 | FIFO consumption | Decided — strict FIFO via per-account advisory lock |
| 9 | Concurrent decrement guards | Decided — advisory lock + consumption PK on slot_id |
| 10 | Postpaid permission read | Decided — in-txn FOR SHARE |
| 11 | BookConfirmModal billing preview source | Decided — client-side via `/api/account/packages` + slot DTO |
| 12 | Package slug naming | Proposed — `Nx{duration}min` |
| 13 | Email notifications | Filed in backlog, out of scope |
| 14 | `package_purchases.payment_order_id` uniqueness | Decided — DB UNIQUE |
| 15 | `account_id` on delete behaviour | Decided — RESTRICT, soft-anonymize chain |
| 16 | Postpaid-paid derived state | Decided — sum-based with explicit CASE-filter so non-paid orders contribute 0 (Codex round 2 HIGH 1) |
| 17 | Pending-package-grant race | Decided — booking-side gate via `payment_orders.metadata` predicate, 15-min window (Codex round 2 HIGH 2) |
| 18 | `payment_orders.paid_at` existence | Verified — column exists since 0001 (Codex round 2 HIGH 3) |
| 19 | Feature flag mechanics | Decided — `process.env.BILLING_WAVE_ACTIVE`, restart required, single-VPS today (Codex round 2 MEDIUM 1) |
| 20 | Migration cutover timestamp | Decided — literal ISO string baked into migration file at creation time (Codex round 2 MEDIUM 3) |
| 21 | `available_packages` cap in 402 body | Decided — top-3 by display_order |
| 22 | Trust boundary on `payment_orders.metadata` | Decided — server-authored fields only; webhook uses email match, not metadata, for ownership (Codex round 3 HIGH) |
| 23 | Feature flag in tests | Decided — integration suite boots with `BILLING_WAVE_ACTIVE=true`; data-layer tests are flag-independent (Codex round 3 MEDIUM) |
| 24 | Webhook ownership resolution | Decided — dual-source: `metadata.accountId` lookup + `decrypt(customer_email_enc)` lookup MUST agree (corroboration). Fail-closed on either fail, mismatch, no-match, multi-match. (Codex rounds 4 + 5) |
| 25 | `customer_email` plaintext source at order init | Decided — `accounts.email` from authenticated session ONLY, never request input (Codex round 5 HIGH) |
| 26 | Retry semantics for webhook fail-closed | Decided — SEVEN well-defined ownership failures = 200 no retry; transient operational failures = 5xx retryable (Codex round 5 MEDIUM, count fixed round 6) |
| 27 | Account-lifecycle policy during in-flight package grant | Decided — anonymize/scheduled-delete refused while ANY in-flight grant exists. Two-branch predicate: (A) pending/3ds_required within 15 min, (B) paid but not yet granted (no time bound). Re-checked at BOTH schedule-step AND execute-step (Codex rounds 6, 7, 8) |

## Honest call-outs (accepted risks for round-3 review)

- **Webhook → package_purchases insert** is inside the same atomic transaction as `payment_allocations` insert. The composite PK `(payment_order_id, kind, target_id)` on allocations + UNIQUE on `package_purchases.payment_order_id` form the DB-enforced idempotency boundary. Replays / concurrent webhook deliveries → at most one of (purchase, allocation) pair lands; partial commits prevented by the wrapping transaction.
- **`paid_at` on `payment_orders`** — verified. Column exists since migration 0001 (`paid_at timestamptz null`), set on `markOrderPaid` in `lib/payments/store-postgres.ts:224`. `expires_at` derived as `paid_at + interval '6 months'` is well-defined.
- **Trigger on `pricing_tariffs`** uses `IS DISTINCT FROM` so harmless writes (e.g. `display_order` reordering) don't fire the rejection. Tested in unit/integration matrix.
- **Consumption PK on `slot_id`** prevents a slot ever being prepaid-consumed twice. If a future flow needs restore-and-rebind on the SAME slot, the design is to cancel-and-create-new-slot. Documented above.
- **`available_packages` in 402 body** capped at top-3 by `display_order`; cabinet has the full `/packages` link.
- **Advisory lock contention** on `pkg_consume:account_id` is a per-account serialization. If a learner double-clicks the book button, the second click waits on the first. Acceptable; ms-scale.
- **Refund flow inheritance** — refund wave shipped 2026-05-11 (Waves 50-54). The consumption ledger is the natural place to restore-package-on-refund via `restored_at`, and `restoreAllConsumptionsForPurchase` (Wave 53, `lib/billing/consumption.ts`) drops every active consumption when a `kind='package'` allocation is reversed. The `paid-state` SUM expression now does a LATERAL `SUM(refunded_kopecks)` against `payment_allocation_reversals` and treats an allocation as fully paying while `SUM < amount_kopecks` (Wave 54 partial-reversal contract). The four read paths (`slotIsPaidByAllocations`, `listSlotPaidStatus`, `listSlotPaymentState`, `listAccountPostpaidDebt`) all agree on this binary all-or-nothing semantic.
- **Pending-package gate window** — 15 minutes is a generous upper bound on CloudPayments webhook delivery (typically 5–30 s). If the webhook is delayed beyond 15 minutes (extreme outage), the gate stops blocking and a postpaid debt could form for a paid-but-not-yet-granted package. Mitigation: the operator's debt review surface (admin debit view) lets them reconcile manually. Acceptable trade vs blocking the learner forever on a stuck webhook.
- **Two-device concurrency display** — covered explicitly in the BookConfirmModal advisory copy; server is authoritative on commit. The modal's preview is a hint, not a contract.
