-- BCS-DEF-4-PUSH (2026-06-06) — per-(account, browser-device) Web Push
-- subscriptions. Multi-device via multiple active rows. Cross-account
-- endpoint reassignment handled at app layer (flip existing row to
-- unsubscribed_at=now() BEFORE insert) — closes the BLOCKER 4 leak.
--
-- Active endpoint is GLOBALLY UNIQUE (partial unique index where
-- unsubscribed_at IS NULL). Web Push endpoint is a browser-bound URL
-- with an opaque token; reuse across accounts means stale binding.
--
-- Plan: docs/plans/bcs-def-4-push-pwa-reminders.md §3.2

create table if not exists learner_push_subscriptions (
  id bigserial primary key,
  account_id uuid not null references accounts(id) on delete restrict,
  endpoint text not null,
  p256dh_b64url text not null,
  auth_b64url text not null,
  user_agent text null,
  unsubscribed_at timestamptz null,
  last_used_at timestamptz null,
  last_status_code integer null,
  last_error text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists learner_push_subs_endpoint_active_unique
  on learner_push_subscriptions (endpoint)
  where unsubscribed_at is null;

create index if not exists learner_push_subs_account_active_idx
  on learner_push_subscriptions (account_id)
  where unsubscribed_at is null;

create index if not exists learner_push_subs_created_at_idx
  on learner_push_subscriptions (created_at desc);

comment on table learner_push_subscriptions is
  'BCS-DEF-4-PUSH (2026-06-06): per-(account, browser-device) Web Push '
  'subscriptions. Active endpoint is globally UNIQUE — cross-account '
  'reassignment handled by flipping the existing row to unsubscribed_at '
  'before insert (anti-leak). Auto-unsubscribed by scheduler on Web Push '
  '410 Gone / 404 Not Found.';
