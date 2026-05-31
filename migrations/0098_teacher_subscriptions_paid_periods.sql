-- A2 — Mid/Pro paid-subscription MVP (one-shot 30-day periods).
--
-- Plan: docs/plans/saas-offer-and-landing-redesign.md A2 +
-- v2 SaaS-оферта §4.2 (PAYG-only mode; recurrent deferred).
--
-- Extends the existing `teacher_subscriptions` 1:1 table (mig 0074)
-- with the columns the paid-subscription lifecycle needs. Operator-
-- managed and Free plans keep these columns NULL (no money flow);
-- only Mid/Pro paid rows populate them.
--
-- Columns added:
--   period_start       — when the current paid period started
--   period_end         — when the current paid period expires (30d default)
--   amount_kopecks     — what the teacher paid for this period
--   payment_order_id   — payment_orders.invoice_id that funded the activation
--   cp_token           — saved CloudPayments token (forward-compat for cron
--                        recurrent — NOT used in MVP, write-only column today)
--   cancelled_at       — when the teacher cancelled (state stays active
--                        until period_end; flag drives auto-downgrade)
--
-- Idempotency: ALTER TABLE … ADD COLUMN IF NOT EXISTS keeps re-runs safe.
--
-- No backfill: existing rows (the bootstrap operator-managed teacher)
-- legitimately have all-NULL period columns; the paid flow doesn't
-- apply to them.

alter table teacher_subscriptions
  add column if not exists period_start timestamptz null;

alter table teacher_subscriptions
  add column if not exists period_end timestamptz null;

alter table teacher_subscriptions
  add column if not exists amount_kopecks integer null
    check (amount_kopecks is null or amount_kopecks > 0);

alter table teacher_subscriptions
  add column if not exists payment_order_id text null;

alter table teacher_subscriptions
  add column if not exists cp_token text null;

alter table teacher_subscriptions
  add column if not exists cancelled_at timestamptz null;

-- Partial index on (period_end) for the future cron `expireOverdue…`
-- pass — only paid rows with a period set need scanning. Bootstrap +
-- Free rows have period_end NULL and are correctly skipped.
create index if not exists teacher_subscriptions_period_end_idx
  on teacher_subscriptions (period_end)
  where period_end is not null and state = 'active';

comment on column teacher_subscriptions.period_start is
  'A2 (2026-05-30): when the current Mid/Pro paid period started. '
  'NULL for free / operator-managed rows.';
comment on column teacher_subscriptions.period_end is
  'A2 (2026-05-30): when the current Mid/Pro paid period expires '
  '(default +30 days from period_start). NULL for free / operator-managed.';
comment on column teacher_subscriptions.amount_kopecks is
  'A2 (2026-05-30): kopecks paid for the current period. '
  'NULL for free / operator-managed.';
comment on column teacher_subscriptions.payment_order_id is
  'A2 (2026-05-30): payment_orders.invoice_id that funded the current period.';
comment on column teacher_subscriptions.cp_token is
  'A2 (2026-05-30): saved CloudPayments token for forward-compat '
  'recurrent rebilling. NOT consulted by MVP; reserved for cron.';
comment on column teacher_subscriptions.cancelled_at is
  'A2 (2026-05-30): when the teacher cancelled their plan. The row '
  'state stays `active` until period_end; cron downgrades to free on expire.';
