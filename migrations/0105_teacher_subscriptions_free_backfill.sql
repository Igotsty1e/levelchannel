-- free-tier-saas-card-and-subscription-row plan §1 item 4 (§0a-5 closure).
--
-- Backfill `teacher_subscriptions` with a free-tier row for every account
-- that holds the `teacher` role and lacks a subscription row. Closes the
-- gap where teachers created via /api/auth/register OR admin role-grant
-- before the new code path (PR following this migration) were left
-- without a subscription row and hit EMPTY_CAPS on /teacher/tariffs +
-- /teacher/packages.
--
-- Filter contract:
--   - `purged_at IS NULL`: hard-purged accounts are pending removal;
--     don't seed billing state.
--   - NO `disabled_at` filter: a re-enabled teacher MUST still have a
--     row (reenableAccount in lib/auth/accounts.ts:356-366 just clears
--     disabled_at; the row should already exist).
--
-- Idempotent: `ON CONFLICT (account_id) DO NOTHING` makes re-runs safe.
--
-- FK gate: `teacher_subscriptions.plan_slug` → `teacher_subscription_plans.slug`
-- (mig 0074). The `free` slug exists since mig 0073, so FK accepts the
-- backfill rows.

insert into teacher_subscriptions (account_id, plan_slug, state)
select distinct ar.account_id, 'free', 'active'
  from account_roles ar
  join accounts a on a.id = ar.account_id
 where ar.role = 'teacher'
   and a.purged_at is null
   and not exists (
     select 1 from teacher_subscriptions ts
      where ts.account_id = ar.account_id
   )
on conflict (account_id) do nothing;
