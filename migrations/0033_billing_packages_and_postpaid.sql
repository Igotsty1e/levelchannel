-- Billing wave PR 1 — foundation for prepay/postpay billing model.
--
-- Design doc: docs/plans/prepay-postpay-billing.md (v9, Codex SIGN-OFF
-- after 9 rounds + self-paranoia).
--
-- This migration ships every schema change required by the wave. The
-- application layer in PR 1 wires the data-layer functions; PR 2 ships
-- the public surface; PR 3 the cabinet UI; PR 4 the admin UI.
--
-- Hard prereq: legal-versioning wave (migration 0032) — required for
-- PR 5 prod gate, not blocking for PR 1-4 development.
--
-- Atomicity: every CREATE / ALTER below runs in the migration's
-- implicit transaction. A failure mid-flight rolls back cleanly.

-- ---------------------------------------------------------------------
-- 1. Catalog: lesson_packages
-- ---------------------------------------------------------------------

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

create index if not exists lesson_packages_active_order_idx
  on lesson_packages (display_order, id) where is_active = true;

-- Trigger: refuse UPDATE of economic fields once a package_purchases
-- row references the package. App-layer guard in admin UI is the
-- user-facing reject reason; this trigger is the security boundary.
-- The trigger fires only when an economic field actually changes
-- (`is distinct from` handles NULL correctly), so harmless writes
-- like `display_order` reordering pass through.
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

drop trigger if exists lesson_packages_economic_fields_guard on lesson_packages;
create trigger lesson_packages_economic_fields_guard
before update on lesson_packages
for each row execute function lesson_packages_economic_fields_immutable();

-- ---------------------------------------------------------------------
-- 2. Per-account purchase instance: package_purchases
-- ---------------------------------------------------------------------

create table if not exists package_purchases (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete restrict,
  package_id uuid not null references lesson_packages(id) on delete restrict,
  -- DB-enforced one-purchase-per-order. Webhook replays + concurrent
  -- deliveries cannot create duplicates.
  payment_order_id text not null unique
    references payment_orders(invoice_id) on delete restrict,
  -- Monetary + descriptive snapshots. Decoupled from lesson_packages
  -- so any future catalog edit (in violation of the trigger above
  -- via direct SQL or a future bug) cannot silently change the
  -- contract on existing learners. Cabinet "Мои пакеты" reads
  -- `title_snapshot`, NOT `lesson_packages.title_ru`.
  amount_kopecks integer not null check (amount_kopecks between 100 and 100000000),
  currency text not null default 'RUB' check (currency = 'RUB'),
  title_snapshot text not null,
  duration_minutes integer not null check (duration_minutes between 15 and 180),
  count_initial integer not null check (count_initial > 0 and count_initial <= 100),
  -- expires_at = payment_orders.paid_at + 6 months, computed at insert
  -- time. Single source of truth; fixed thereafter, no extension.
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

-- Composite index supports the hot booking path "find earliest-
-- expiring matching package for this account". Expiry filter goes
-- in the query, not the index (Postgres won't accept volatile
-- functions in a partial index predicate).
create index if not exists package_purchases_account_active_idx
  on package_purchases (account_id, duration_minutes, expires_at, id);

-- ---------------------------------------------------------------------
-- 3. Immutable ledger: package_consumptions
-- ---------------------------------------------------------------------
--
-- One row per consumption event. `slot_id` is PK = at most one
-- consumption row per slot lifetime. Restore = stamp `restored_at`
-- on the same row, never delete. Re-bind on the same slot is not
-- supported; cancel-and-create-new-slot is the path. Trade for
-- unconditional double-charge protection.

create table if not exists package_consumptions (
  slot_id uuid not null primary key
    references lesson_slots(id) on delete restrict,
  package_purchase_id uuid not null
    references package_purchases(id) on delete restrict,
  consumed_at timestamptz not null default now(),
  consumed_by_actor text not null
    check (consumed_by_actor in ('learner', 'admin', 'teacher')),
  restored_at timestamptz,
  restored_by_actor text
    check (restored_by_actor is null or restored_by_actor in ('learner', 'admin', 'teacher')),
  restored_reason text,
  -- restored_at and restored_by_actor must be set together.
  constraint package_consumptions_restore_pair_check
    check ((restored_at is null) = (restored_by_actor is null))
);

-- Active count derivation joins on this; index supports the hot
-- path "how many units of THIS purchase are still consumed".
create index if not exists package_consumptions_purchase_active_idx
  on package_consumptions (package_purchase_id) where restored_at is null;

-- ---------------------------------------------------------------------
-- 4. accounts.postpaid_allowed
-- ---------------------------------------------------------------------

alter table accounts
  add column if not exists postpaid_allowed boolean not null default false;

-- ---------------------------------------------------------------------
-- 5. lesson_slots.legacy_grandfathered
-- ---------------------------------------------------------------------
--
-- Predicate-based backfill with a literal cutover timestamp baked
-- into this migration file at creation time (NOT now() at execute
-- time). Replays on dev / staging / replay branches produce the
-- same set. The literal is set when this migration is committed.

alter table lesson_slots
  add column if not exists legacy_grandfathered boolean not null default false;

-- Cutover anchor: 2026-05-10T00:00:00Z (literal).
update lesson_slots
   set legacy_grandfathered = true
 where status = 'booked'
   and start_at > '2026-05-10T00:00:00Z'::timestamptz
   and learner_account_id is not null;

-- ---------------------------------------------------------------------
-- 6. payment_allocations.kind enum widening
-- ---------------------------------------------------------------------
--
-- Allocation table from migration 0022 set kind to a single value
-- 'lesson_slot'. Widen the CHECK so the package branch (PR 2 webhook)
-- can write 'package' allocations against package_purchases.id.

alter table payment_allocations
  drop constraint if exists payment_allocations_kind_check;
alter table payment_allocations
  add constraint payment_allocations_kind_check
    check (kind in ('lesson_slot', 'package'));

-- ---------------------------------------------------------------------
-- 7. Retroactive: pricing_tariffs.amount_kopecks immutability
-- ---------------------------------------------------------------------
--
-- The existing `updateTariff` app-layer function permits in-place
-- amount_kopecks edits. Once any lesson_slot references a tariff,
-- that edit silently rewrites historical slots' notional price.
-- Same shape as the lesson_packages trigger: refuse the UPDATE if
-- references exist, allow if none.
--
-- This is the first DB-level enforcement of the FK-as-snapshot
-- pattern Ivan pinned in the billing-design discussion: tariff
-- price changes = insert new row + soft-archive old, never edit
-- in place after first reference.

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

drop trigger if exists pricing_tariffs_amount_guard on pricing_tariffs;
create trigger pricing_tariffs_amount_guard
before update on pricing_tariffs
for each row execute function pricing_tariffs_amount_immutable();
