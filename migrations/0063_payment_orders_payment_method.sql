-- SBP-PAY — typed payment_method column on payment_orders.
--
-- Single source of truth for the method that completed a payment. Prior
-- to this migration the discriminator was implicit: card flow was the
-- only money-flow path, `provider='admin_grant'` carved out the non-
-- money grant path, and any future method (СБП, Apple Pay, ...) would
-- have had to ride on `metadata` (jsonb) — a guaranteed-drift surface.
--
-- The column is `null`-able because legacy rows lived without it; the
-- backfill below populates them, and new rows go through
-- `createCloudPaymentsOrder` / `createMockOrder` which always set it.
-- Webhook handler reads `payment_method` (top-level column), NOT
-- `metadata.payment_method` — see §0a BLOCKER#6 closure + §0b BLOCKER#2
-- closure in docs/plans/sbp-payments.md.

-- Step 1 — additive column with CHECK on the accepted methods.
-- 'card', 'sbp', 'admin_grant' are the only three known today. New
-- methods (Apple Pay, Google Pay, future-X) will land via a follow-up
-- migration that extends the CHECK list.
alter table payment_orders
  add column if not exists payment_method text null
    check (payment_method is null
           or payment_method in ('card', 'sbp', 'admin_grant'));

-- Step 2 — backfill the column for existing rows. Admin-grant rows are
-- identifiable by `provider='admin_grant'` (triple-CHECK in migration
-- 0051 guarantees this); everything else was historically card-only.
update payment_orders
  set payment_method = case
    when provider = 'admin_grant' then 'admin_grant'
    else 'card'
  end
  where payment_method is null;

-- Step 3 — partial index for fast filtering in admin reconciliation
-- views ("show me all SBP-failed orders this week"). Partial on
-- `payment_method is not null` so the index doesn't include legacy
-- pre-backfill rows (none after step 2; the partial-ness is a future-
-- proofing belt against any insert that bypasses the create helper).
create index if not exists payment_orders_method_status_idx
  on payment_orders (payment_method, status)
  where payment_method is not null;

comment on column payment_orders.payment_method is
  'SBP-PAY (2026-05-19): canonical method discriminator. ''card'' '
  '(default for the widget + saved-token flow), ''sbp'' (SBP QR via '
  'CloudPayments server API), ''admin_grant'' (non-money operator-'
  'driven package grant). Single source of truth; webhook handler '
  'reads/writes this column rather than metadata.payment_method.';
