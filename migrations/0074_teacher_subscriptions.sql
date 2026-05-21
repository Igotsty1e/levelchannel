-- SAAS-PIVOT Epic 1 Day 1 — teacher_subscriptions per-teacher state.
--
-- Plan: docs/plans/saas-pivot-master.md §2.1 row `0074`, §2.3 state
-- machine, §2.10 past_due/cancelled gate matrix, §5 Day 1 step 2.
--
-- One row per teacher account. `account_id` is BOTH PK and FK so the
-- 1:1 relationship is structurally enforced. `plan_slug` is FK to the
-- reference table from mig 0073; ON UPDATE CASCADE keeps renames safe
-- (today the slug set is closed, but a future ops decision could
-- rename `mid` → something — we'd rather not break this FK).
--
-- State machine values (§2.3):
--   - active     — current plan paid (or Free).
--   - past_due   — Mid/Pro renewal failed; 3-day grace (§2.10).
--   - cancelled  — teacher cancelled; downgrades to Free at period_end.
--   - suspended  — operator-disabled (terms violation).
--
-- No backfill in this migration — the bootstrap teacher's row is
-- inserted by mig 0083 step 4 with plan='operator-managed' + state='active'.
-- New teachers' rows are inserted by the /register?role=teacher route
-- (Epic 1 Day 2). NOT NULL on `renewal_at` deferred for Free tier where
-- there is no renewal — kept nullable here.

create table if not exists teacher_subscriptions (
  account_id uuid primary key references accounts(id) on delete cascade,
  plan_slug text not null
    references teacher_subscription_plans(slug)
    on update cascade
    on delete restrict,
  state text not null default 'active'
    check (state in ('active', 'past_due', 'cancelled', 'suspended')),
  renewal_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists teacher_subscriptions_state_idx
  on teacher_subscriptions (state);

create index if not exists teacher_subscriptions_renewal_idx
  on teacher_subscriptions (renewal_at)
  where renewal_at is not null;

-- Standard updated_at touch trigger; same shape as
-- teacher_calendar_integrations_touch_updated_at (mig 0043).
create or replace function teacher_subscriptions_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists teacher_subscriptions_touch_updated_at_trg
  on teacher_subscriptions;
create trigger teacher_subscriptions_touch_updated_at_trg
  before update on teacher_subscriptions
  for each row execute function teacher_subscriptions_touch_updated_at();

comment on table teacher_subscriptions is
  'SAAS-PIVOT Epic 1 (2026-05-22): per-teacher subscription state. '
  '1:1 with accounts via PK=account_id. Plan: docs/plans/saas-pivot-master.md §2.3.';
