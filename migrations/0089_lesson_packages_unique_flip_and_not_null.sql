-- SAAS-PIVOT Epic 3 Day 4 — finish the lesson_packages / package_purchases
-- teacher_id rollout: drop global UNIQUE(slug), add composite
-- UNIQUE(teacher_id, slug), flip both teacher_id columns NOT NULL.
--
-- Plan: docs/plans/saas-pivot-master.md §2.1 row `0076b`, §5 Day 4 step 1
-- (round-22 contract: 0076c → 0076b/d NOT NULL flip happens after 0076c).
--
-- NAMING: the plan called this `0076b`, but lexicographic ordering
-- requires this migration to run AFTER:
--   - 0076c_package_purchases_teacher_id.sql (adds the column whose
--     NOT NULL we flip),
--   - 0083_bootstrap_teacher_account.sql (backfills teacher_id on
--     every legacy row — without this the NOT NULL flip would fail
--     on prod where pre-existing rows lived without teacher_id),
--   - 0085_payment_orders_teacher_account_id.sql (sibling Day-1
--     backfill; not strictly required by THIS file but keeps the
--     Day-1-then-Day-4 wave boundary clean).
-- Numbered `0089` so the runner picks the correct order, AFTER Day-3's
-- 0088_pricing_tariffs_teacher_id_not_null.sql:
--   0076a → 0076c → 0077 → 0082 → 0083 → 0085 → 0088 → 0089 → 0090 → 0091.
--
-- ORDER: runs AFTER mig 0083 (which backfills teacher_id on every row
-- via the bootstrap row-MOVE). On a fresh DB with no admin / no
-- pre-existing rows, the IS NULL guards below are trivially true and
-- the NOT NULL flip is a no-op (no rows → no violation).
--
-- Pre-condition guards: defensive RAISE EXCEPTION if any
-- lesson_packages or package_purchases row STILL has teacher_id IS
-- NULL. mig 0083 should have caught every legacy row; this guard
-- protects against an out-of-order replay where 0076b runs before
-- the backfill landed.
--
-- The whole file is one TX (the migration runner wraps it). A failure
-- anywhere rolls back the unique-flip + the NOT NULL flip together —
-- there is no partial state.

-- ------------------------------------------------------------------
-- Step 0 — pre-condition guards.
-- ------------------------------------------------------------------

do $check$
declare
  pkg_nulls integer;
  purchase_nulls integer;
begin
  select count(*) into pkg_nulls
    from lesson_packages
   where teacher_id is null;
  if pkg_nulls > 0 then
    raise exception 'mig 0076b: refusing to flip teacher_id NOT NULL — % lesson_packages rows still have teacher_id IS NULL. Run mig 0083 first (bootstrap row-MOVE) to claim legacy rows.', pkg_nulls;
  end if;

  select count(*) into purchase_nulls
    from package_purchases
   where teacher_id is null;
  if purchase_nulls > 0 then
    raise exception 'mig 0076b: refusing to flip teacher_id NOT NULL — % package_purchases rows still have teacher_id IS NULL. Run mig 0083 first (bootstrap row-MOVE) to claim legacy rows.', purchase_nulls;
  end if;
end
$check$;

-- ------------------------------------------------------------------
-- Step 1 — drop the global UNIQUE on slug. Postgres named the
-- inline `text not null unique` constraint `lesson_packages_slug_key`
-- by default (mig 0033). The DROP CONSTRAINT IF EXISTS is defensive
-- in case some environment renamed it manually.
-- ------------------------------------------------------------------

alter table lesson_packages
  drop constraint if exists lesson_packages_slug_key;

-- ------------------------------------------------------------------
-- Step 2 — add composite UNIQUE(teacher_id, slug). Two teachers can
-- now ship a package called 'lessons-10' independently; collisions
-- within a single teacher's catalog still raise 23505 → route layer
-- maps to 409 slug_already_exists.
--
-- IF NOT EXISTS isn't a thing on ADD CONSTRAINT, but a DO block makes
-- the migration idempotent on re-run.
-- ------------------------------------------------------------------

do $unique_flip$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'lesson_packages_teacher_slug_unique'
       and conrelid = 'lesson_packages'::regclass
  ) then
    alter table lesson_packages
      add constraint lesson_packages_teacher_slug_unique
        unique (teacher_id, slug);
  end if;
end
$unique_flip$;

-- ------------------------------------------------------------------
-- Step 3 — flip lesson_packages.teacher_id NOT NULL.
-- ------------------------------------------------------------------

alter table lesson_packages
  alter column teacher_id set not null;

-- ------------------------------------------------------------------
-- Step 4 — flip package_purchases.teacher_id NOT NULL (round-22
-- contract: same TX as the lesson_packages flip).
-- ------------------------------------------------------------------

alter table package_purchases
  alter column teacher_id set not null;

comment on constraint lesson_packages_teacher_slug_unique on lesson_packages is
  'SAAS-PIVOT Epic 3 Day 4 (2026-05-22): per-teacher slug uniqueness. '
  'Replaces the global UNIQUE(slug) from mig 0033 so multiple teachers '
  'can ship their own catalog independently. Plan: §2.1.';
