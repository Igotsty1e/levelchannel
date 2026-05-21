-- SAAS-PIVOT Epic 1 Day 1 — teacher_subscription_plans reference table.
--
-- Plan: docs/plans/saas-pivot-master.md §2.1 row `0073`, §5 Day 1 step 1.
--
-- Four hard-coded plan-tier rows. Slug is the public-stable identifier
-- (NEVER `operator` — canonical slug is `operator-managed` per §1.2 +
-- §2.1). `learner_limit` NULL means unlimited (plan-4). `features` is
-- a forward-compatible jsonb (currently unused — readers do not depend
-- on its shape; future toggles like `google_calendar`, `tg_reminders`
-- can land here without a migration).
--
-- Read shape (Epic 4-MVP): `select * from teacher_subscription_plans
-- where slug = $1` — single-row lookup keyed off teacher_subscriptions.plan_slug.
--
-- Idempotency: re-running this migration is safe. CREATE TABLE IF NOT
-- EXISTS + INSERT ... ON CONFLICT (slug) DO NOTHING means the rows seed
-- exactly once, even if the migration is re-applied or replayed.

create table if not exists teacher_subscription_plans (
  slug text primary key,
  title_ru text not null,
  price_kopecks_monthly integer not null check (price_kopecks_monthly >= 0),
  learner_limit integer null check (learner_limit is null or learner_limit > 0),
  features jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint teacher_subscription_plans_slug_format
    check (slug ~ '^[a-z0-9][a-z0-9-]{1,40}$')
);

insert into teacher_subscription_plans (slug, title_ru, price_kopecks_monthly, learner_limit, features)
values
  ('free', 'Free', 0, 1, '{}'::jsonb),
  ('mid', 'Mid', 30000, 5, '{}'::jsonb),
  ('pro', 'Pro', 80000, 30, '{}'::jsonb),
  ('operator-managed', 'Operator-managed', 0, null, '{"money_flow_through_platform": true}'::jsonb)
on conflict (slug) do nothing;

comment on table teacher_subscription_plans is
  'SAAS-PIVOT Epic 1 (2026-05-22): teacher subscription tier catalog. '
  'Four canonical slugs: free / mid / pro / operator-managed (NEVER `operator`). '
  'Plan: docs/plans/saas-pivot-master.md §2.1 + §1.2.';
comment on column teacher_subscription_plans.learner_limit is
  'NULL = unlimited (operator-managed only). Active-learner cap is '
  'enforced at write-routes via requireActiveSubscription() helper.';
