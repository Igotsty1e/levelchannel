-- SAAS-PIVOT Epic 6 Day 6 — payment_orders.teacher_account_id NOT NULL flip.
--
-- Plan: docs/plans/saas-pivot-master.md §2.1 row `0094` (renumbered),
-- §2.8 writer table, §5 Day 6.
--
-- Day 1 (mig 0085) added the column nullable and backfilled three
-- buckets (slot-bound / package-bound / bootstrap). Day 6 (this
-- migration) flips it NOT NULL, AFTER all SEVEN writers (§2.8) have
-- been updated to pass teacher_account_id at INSERT:
--   1. app/api/payments/route.ts            (custom amount)
--   2. app/api/checkout/package/[slug]      (learner package buy)
--   3. app/api/admin/packages/[id]/grant    (admin grant)
--   4. app/api/payments/sbp/create-qr       (SBP QR)
--   5. app/api/payments/charge-token        (one-click saved card)
--   6. lib/payments/provider/checkout.ts    (createPayment + chargeWithSavedCard)
--   7. lib/billing/teacher-grant.ts         (owned by PR #415)
--
-- Pre-flight guard: count NULL rows. If any remain, fail loudly — this
-- means a writer sweep was incomplete and the NOT NULL flip would deadlock.
--
-- Defence-in-depth BEFORE INSERT trigger: any legacy code path (or
-- pre-existing test fixture) that omits teacher_account_id falls
-- through to the bootstrap teacher. This is the SAME backfill bucket
-- (c) as mig 0085's Day-1 backfill — "unattributable orders → bootstrap".
-- The trigger keeps NOT NULL safe when bootstrap exists; in DBs WITHOUT
-- a bootstrap row (fresh test DB without seed), the trigger no-ops and
-- the NOT NULL constraint fires → INSERT fails. So "INSERT without
-- teacher_account_id when bootstrap is absent" still raises NOT NULL,
-- preserving the contract.

do $$
declare null_count int;
begin
  select count(*) into null_count from payment_orders where teacher_account_id is null;
  if null_count > 0 then
    raise exception 'mig 0094: % payment_orders rows still NULL — Day-6 writer sweep incomplete', null_count;
  end if;
end $$;

alter table payment_orders alter column teacher_account_id set not null;

comment on column payment_orders.teacher_account_id is
  'SAAS-PIVOT Epic 6 Day 6 (2026-05-22): owning teacher account for the '
  'order. NOT NULL after Day-6 writer sweep. Every writer derives the '
  'value from slot/package context or falls back to the bootstrap teacher. '
  'Plan: docs/plans/saas-pivot-master.md §2.8.';

-- BEFORE INSERT trigger — fallback to bootstrap teacher for legacy
-- code paths that don't pass teacher_account_id. Mirrors mig 0085
-- bucket (c). When bootstrap is absent the trigger is a no-op and the
-- NOT NULL constraint catches the violation.
create or replace function payment_orders_fill_teacher_account_id()
returns trigger
language plpgsql
as $$
begin
  if new.teacher_account_id is null then
    select id into new.teacher_account_id
      from accounts
     where teacher_account_migration_marker = 'bootstrap-2026-05-22'
     limit 1;
  end if;
  return new;
end;
$$;

drop trigger if exists payment_orders_fill_teacher_account_id_trg
  on payment_orders;
create trigger payment_orders_fill_teacher_account_id_trg
  before insert on payment_orders
  for each row execute function payment_orders_fill_teacher_account_id();

comment on function payment_orders_fill_teacher_account_id() is
  'SAAS-PIVOT Epic 6 Day 6 (2026-05-22): defence-in-depth bootstrap '
  'fallback for legacy INSERTs. Mirrors mig 0085 backfill bucket (c). '
  'No-op when bootstrap is absent so the NOT NULL constraint still '
  'rejects truly unattributable orders. Plan: §2.8.';
