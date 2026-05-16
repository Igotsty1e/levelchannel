-- PKG-ADMIN-GRANT LBL.0 — operator-driven package grant.
--
-- admin-ux-coverage.md §10.1 P2. Operator grants a package to a learner
-- without going through a real CloudPayments charge (refund-credits,
-- marketing comps, customer-service make-goods).
--
-- Design choice (5-round plan-mode paranoia SIGN-OFF, see
-- docs/plans/pkg-admin-grant.md): synthetic payment_orders row with
-- provider='admin_grant' + status='granted'. NOT money flow; money-
-- side queries filter on provider/status. Single TX writes
-- payment_orders + package_purchases + payment_allocations
-- atomically (admin grants SKIP processPackageGrant — see round-3
-- BLOCKER closure).
--
-- This migration extends the provider + status taxonomies, adds
-- the granted_by_operator_id column, and enforces a triple-
-- consistency CHECK so an 'admin_grant' row is always identifiable
-- by all three signals.

-- Step 1 — add granted_by_operator_id column. NULL for paid orders,
-- NOT NULL for admin-grant orders (enforced by triple-CHECK below).
alter table payment_orders
  add column if not exists granted_by_operator_id uuid null
    references accounts(id) on delete restrict;

-- Step 2 — extend provider check. Existing values: 'cloudpayments',
-- 'mock'. New: 'admin_grant'.
alter table payment_orders
  drop constraint if exists payment_orders_provider_check;
alter table payment_orders
  add constraint payment_orders_provider_check
  check (provider in ('cloudpayments', 'mock', 'admin_grant'));

-- Step 3 — extend status check. Existing values: 'pending',
-- '3ds_required', 'paid', 'failed', 'cancelled'. New: 'granted'.
alter table payment_orders
  drop constraint if exists payment_orders_status_check;
alter table payment_orders
  add constraint payment_orders_status_check
  check (status in ('pending', '3ds_required', 'paid', 'failed', 'cancelled', 'granted'));

-- Step 4 — triple-consistency invariant. provider='admin_grant' iff
-- granted_by_operator_id IS NOT NULL iff status='granted'. The
-- equivalence is enforced both directions: a row can't lie about
-- whether it's an admin grant.
alter table payment_orders
  add constraint payment_orders_admin_grant_consistency
  check (
    (provider = 'admin_grant'
      and granted_by_operator_id is not null
      and status = 'granted')
    or
    (provider <> 'admin_grant'
      and granted_by_operator_id is null
      and status <> 'granted')
  );

-- Step 5 — index for operator audit queries ("all grants by this admin").
create index if not exists payment_orders_granted_by_idx
  on payment_orders (granted_by_operator_id)
  where granted_by_operator_id is not null;

comment on column payment_orders.granted_by_operator_id is
  'PKG-ADMIN-GRANT (2026-05-16): operator account id when this is a '
  'non-money admin-driven package grant. Triple-CHECK enforces '
  'provider=''admin_grant'' iff this is NOT NULL iff status=''granted''.';
