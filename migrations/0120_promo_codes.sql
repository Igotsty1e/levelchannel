-- PROMO-CODES Sub-PR A — promo voucher mechanism foundation.
--
-- Plan: docs/plans/promo-codes-tariffs-2026-06-09.md §2.1 / §2.2.
-- Owner Q-set (round 2): Q1 LAUNCH3 public, Q2 pro-only via admin-UI,
--   Q3+Q3.1 redeem rejected with typed error when paid subscription
--   active, Q4 minimal anti-abuse, Q5 admin-only creation, Q10 (a)
--   unique(code, account_id) sufficient, no e-mail dedup.
--
-- Two tables:
--   promo_codes — voucher template (code, what it grants, validity,
--     redemption cap, anti-abuse gates, audit).
--   promo_code_redemptions — append-only journal of redeem events.
--
-- Schema invariants:
--   - grant_plan_slug FK to teacher_subscription_plans.slug (mig 0073)
--     — guarantees code can only grant a real plan tier.
--   - max_redemptions optional (NULL = unlimited; LAUNCH3 ships NULL).
--   - unique (promo_code_id, account_id) in redemptions — one
--     account = one redeem per code (even across deletion+re-register
--     of same e-mail per Q10 (a), unique is by account_id not email).
--   - redeemed_ip_prefix is `inet` already-truncated /24 IPv4 or /48
--     IPv6 per lib/analytics/server.ts truncateIp() — NEVER raw IP.
--
-- citext extension: case-insensitive code lookup. Idempotent so re-run
-- safe.
--
-- No backfill rows. The first LAUNCH3 row is inserted by ops via
-- /admin/promo-codes UI (Sub-PR B).

create extension if not exists citext;

create table if not exists promo_codes (
  id                      uuid primary key default gen_random_uuid(),
  code                    citext not null unique,
  description             text,

  grant_plan_slug         text not null
                            references teacher_subscription_plans(slug)
                            on update cascade
                            on delete restrict,
  grant_days              integer not null check (grant_days between 1 and 365),

  max_redemptions         integer check (max_redemptions is null or max_redemptions > 0),
  redemption_count        integer not null default 0
                            check (redemption_count >= 0),

  valid_from              timestamptz not null default now(),
  valid_until             timestamptz,

  created_at              timestamptz not null default now(),
  created_by_account_id   uuid references accounts(id) on delete set null,
  revoked_at              timestamptz,
  revoked_reason          text,

  requires_email_verified boolean not null default true,

  constraint promo_codes_valid_window_check
    check (valid_until is null or valid_until > valid_from),
  constraint promo_codes_revoked_reason_when_revoked
    check ((revoked_at is null) = (revoked_reason is null))
);

create index if not exists promo_codes_valid_window_idx
  on promo_codes (valid_from, valid_until)
  where revoked_at is null;

create index if not exists promo_codes_revoked_idx
  on promo_codes (revoked_at)
  where revoked_at is not null;

create table if not exists promo_code_redemptions (
  id                      uuid primary key default gen_random_uuid(),
  promo_code_id           uuid not null
                            references promo_codes(id)
                            on delete restrict,
  account_id              uuid not null
                            references accounts(id)
                            on delete cascade,
  redeemed_at             timestamptz not null default now(),

  -- Snapshot of subscription state at redeem (subscription_account_id
  -- references the same accounts row as account_id because
  -- teacher_subscriptions PK = account_id per mig 0074). Stored
  -- separately so future cross-account redeem flows do not require
  -- schema change.
  subscription_account_id uuid not null
                            references accounts(id)
                            on delete cascade,

  granted_plan_slug       text not null
                            references teacher_subscription_plans(slug)
                            on update cascade
                            on delete restrict,
  granted_days            integer not null check (granted_days between 1 and 365),
  granted_until           timestamptz not null,

  -- PII-safe per 152-ФЗ: truncated /24 IPv4 or /48 IPv6 via
  -- lib/analytics/server.ts truncateIp(). NEVER raw IP.
  redeemed_ip_prefix      inet,
  redeemed_ua             text,

  unique (promo_code_id, account_id)
);

create index if not exists promo_code_redemptions_account_idx
  on promo_code_redemptions (account_id, redeemed_at desc);

create index if not exists promo_code_redemptions_granted_until_idx
  on promo_code_redemptions (granted_until)
  where granted_until is not null;

comment on table promo_codes is
  'PROMO-CODES Sub-PR A (2026-06-09): voucher templates. Owner-created '
  'via /admin/promo-codes. Read by /api/teacher/promo-codes/redeem.';
comment on table promo_code_redemptions is
  'PROMO-CODES Sub-PR A (2026-06-09): append-only journal of redeem '
  'events. One row per successful redeem. unique(code, account) = no '
  'double-redeem.';
comment on column promo_code_redemptions.redeemed_ip_prefix is
  '152-ФЗ truncated: /24 for IPv4 or /48 for IPv6 via truncateIp(). '
  'Raw IP is NEVER stored.';
