-- SAAS-PIVOT Epic 3 Day 4 — teacher_grant non-money provider rollout.
--
-- Plan: docs/plans/saas-pivot-master.md §2.1 row `0087`
-- (round-27/28/29/30/31 closures), §3 Epic 3 line "teacher_grant".
--
-- Mirrors mig 0051 (admin_grant) shape, but with `granted_by_teacher_id`
-- + distinct teacher_granted / teacher_revoked statuses + the
-- teacher_grant payment_method value. The triple-CHECK from 0051 is
-- replaced by a quadruple-CHECK that handles the four buckets:
--   - card / sbp money orders
--   - admin_grant non-money orders (existing)
--   - teacher_grant non-money orders (new)
--   (the 4th bucket is just the disjunction of the first two — not
--    a separate clause; see CHECK body below)
--
-- Money path stays bit-identical: provider in ('cloudpayments','mock'),
-- payment_method in ('card','sbp'), grant columns both NULL, status
-- in the pre-existing five money values.

-- ------------------------------------------------------------------
-- Step 1 — new column for teacher actor.
-- granted_by_teacher_id is the teacher account that issued the grant.
-- NULL for everything else (card, sbp, admin_grant). Triple-CHECK
-- below enforces "teacher_grant iff this is NOT NULL".
-- ------------------------------------------------------------------

alter table payment_orders
  add column if not exists granted_by_teacher_id uuid null
    references accounts(id) on delete restrict;

-- ------------------------------------------------------------------
-- Step 2 — extend the provider CHECK list.
-- Existing values (post-mig-0051): cloudpayments, mock, admin_grant.
-- New value: teacher_grant.
-- ------------------------------------------------------------------

alter table payment_orders
  drop constraint if exists payment_orders_provider_check;
alter table payment_orders
  add constraint payment_orders_provider_check
  check (provider in ('cloudpayments', 'mock', 'admin_grant', 'teacher_grant'));

-- ------------------------------------------------------------------
-- Step 3 — extend the status CHECK list.
-- Existing (post-mig-0051): pending, 3ds_required, paid, failed,
--                           cancelled, granted.
-- New: teacher_granted, teacher_revoked.
-- ------------------------------------------------------------------

alter table payment_orders
  drop constraint if exists payment_orders_status_check;
alter table payment_orders
  add constraint payment_orders_status_check
  check (status in (
    'pending', '3ds_required', 'paid', 'failed', 'cancelled',
    'granted',
    'teacher_granted', 'teacher_revoked'
  ));

-- ------------------------------------------------------------------
-- Step 4 — extend the payment_method CHECK list (round-30 BLOCKER #1
-- closure). Was: ('card','sbp','admin_grant'). New: add 'teacher_grant'.
-- The ensureSchema() inline CHECK in lib/payments/store-postgres.ts is
-- updated in lockstep — both paths converge after migrate:up.
-- ------------------------------------------------------------------

alter table payment_orders
  drop constraint if exists payment_orders_payment_method_check;
alter table payment_orders
  add constraint payment_orders_payment_method_check
  check (
    payment_method is null
    or payment_method in ('card', 'sbp', 'admin_grant', 'teacher_grant')
  );

-- ------------------------------------------------------------------
-- Step 5 — replace the triple-CHECK from mig 0051 with a
-- quadruple-CHECK that adds the teacher_grant bucket. The constraint
-- name is renamed from payment_orders_admin_grant_consistency to
-- payment_orders_grant_consistency so the new scope is reflected
-- (admin AND teacher).
-- ------------------------------------------------------------------

alter table payment_orders
  drop constraint if exists payment_orders_admin_grant_consistency;
alter table payment_orders
  drop constraint if exists payment_orders_grant_consistency;
alter table payment_orders
  add constraint payment_orders_grant_consistency
  check (
    -- (a) money orders (card / sbp via cloudpayments / mock).
    (provider in ('cloudpayments', 'mock')
      and granted_by_operator_id is null
      and granted_by_teacher_id is null
      and status in ('pending', '3ds_required', 'paid', 'failed', 'cancelled')
      and (payment_method is null or payment_method in ('card', 'sbp')))
    or
    -- (b) admin_grant: NON-money operator-driven grant.
    (provider = 'admin_grant'
      and granted_by_operator_id is not null
      and granted_by_teacher_id is null
      and status = 'granted'
      and payment_method = 'admin_grant')
    or
    -- (c) teacher_grant: NON-money teacher-driven grant (THIS migration).
    (provider = 'teacher_grant'
      and granted_by_operator_id is null
      and granted_by_teacher_id is not null
      and status in ('teacher_granted', 'teacher_revoked')
      and payment_method = 'teacher_grant')
  );

-- ------------------------------------------------------------------
-- Step 6 — index for "all grants by this teacher" queries from the
-- /teacher/packages cabinet. Mirrors mig 0051's
-- `payment_orders_granted_by_idx` shape (partial on NOT NULL).
-- ------------------------------------------------------------------

create index if not exists payment_orders_granted_by_teacher_idx
  on payment_orders (granted_by_teacher_id)
  where granted_by_teacher_id is not null;

comment on column payment_orders.granted_by_teacher_id is
  'SAAS-PIVOT Epic 3 Day 4 (2026-05-22): teacher account id when this is a '
  'teacher-driven NON-money package grant (provider=''teacher_grant''). '
  'Quadruple-CHECK enforces provider=''teacher_grant'' iff this is NOT NULL '
  'iff status in (''teacher_granted'',''teacher_revoked'') iff '
  'payment_method=''teacher_grant''.';
