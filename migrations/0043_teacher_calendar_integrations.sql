-- BCS-A.2 — Teacher Google Calendar integration: tokens, sync state,
-- push-notification subscription.
--
-- Design doc: docs/plans/booking-calendly-style.md §3.2.
--
-- Holds (a) OAuth tokens, encrypted at rest via CALENDAR_ENCRYPTION_KEY
-- (separate env from AUDIT_ENCRYPTION_KEY for blast-radius — plan §8
-- invariant #6); (b) per-teacher selection of read calendars and the
-- single write calendar; (c) sync_state machine (`active`/`degraded`/
-- `disconnected`); (d) Google push-notification subscription channel
-- with monotonic message guard.
--
-- MSK-only MVP — DB CHECK on related accounts.timezone enforced via
-- the trigger below. Plan §8 invariant #9.
--
-- Token encryption columns mirror the audit pattern (pgcrypto dual-write,
-- separate key, rotation pattern reused). The CALENDAR_ENCRYPTION_KEY
-- env is introduced in BCS-C.1 (lib/calendar/encryption.ts), not here.

create table if not exists teacher_calendar_integrations (
  account_id uuid primary key references accounts(id) on delete cascade,
  provider text not null check (provider in ('google')),

  -- ------------------------ Tokens ------------------------
  -- pgcrypto-encrypted via lib/calendar/encryption.ts (CALENDAR_ENCRYPTION_KEY).
  -- BYTEA, not text — same shape as payment_audit_events.customer_email_enc.
  access_token_enc bytea,
  refresh_token_enc bytea,
  scope text,
  token_expires_at timestamptz,

  -- ------------------- Calendar selection -----------------
  -- read_calendar_ids: array of Google calendar ids to PULL busy from.
  -- write_calendar_id: single calendar where LC pushes its own events.
  -- Invariant (enforced app-layer at setup): write_calendar_id IN read_calendar_ids.
  -- The DB constraint is hard to express as CHECK on an array membership
  -- without a function; we enforce in the OAuth callback (BCS-C.3).
  read_calendar_ids text[] not null default '{}',
  write_calendar_id text,

  -- ------------------- Sync state machine -----------------
  -- 'active': last pull within TTL, tokens valid
  -- 'degraded': last pull > TTL but tokens still valid; busy cache
  --   IGNORED by bookSlot per F3 freshness contract
  -- 'disconnected': teacher revoked OR tokens hard-failed
  sync_state text not null default 'disconnected'
    check (sync_state in ('active', 'degraded', 'disconnected')),

  -- ------------------- Integration epoch ------------------
  -- Rotated on each successful connect/reconnect. Stamped on
  -- lesson_slots.integration_epoch when create push succeeds.
  -- Survives disconnect/reconnect; old bindings surface in F8 orphan
  -- UI when epoch mismatches.
  epoch text not null default gen_random_uuid()::text,

  -- ------------------- Operational state ------------------
  last_pulled_at timestamptz,
  last_push_at timestamptz,
  -- F9‴ gate: bumped on disconnected→active state-change-to-healthy.
  -- Reconcile re-enqueues `terminal_failure` delete ONLY when
  -- last_reconnected_at > job.last_attempt_at.
  last_reconnected_at timestamptz,
  last_error text,

  -- ------------------- Google push channel ----------------
  -- Notifications subscription via channels.watch. Renewed before
  -- channel_expires_at (max 7d Google-side). channel_token is the
  -- per-subscription HMAC secret we sign and Google echoes back
  -- in the X-Goog-Channel-Token header.
  channel_id text,
  channel_resource_id text,
  channel_expires_at timestamptz,
  channel_token text,

  -- Monotonic replay guard. Webhook drops messages whose
  -- X-Goog-Message-Number <= last_seen_message_number, plan §4.9.
  last_seen_message_number bigint,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Hot path: cron sweep across active+degraded integrations. Partial
-- index keeps `disconnected` rows out of the working set.
create index if not exists teacher_calendar_integrations_sync_state_idx
  on teacher_calendar_integrations (sync_state, last_pulled_at)
  where sync_state in ('active', 'degraded');

-- Webhook handler looks up by channel_id (header from Google) to verify
-- the message belongs to a known subscription. Partial — null channel_id
-- rows are disconnected integrations with no active subscription.
create unique index if not exists teacher_calendar_integrations_channel_id_unique
  on teacher_calendar_integrations (channel_id)
  where channel_id is not null;

-- MSK-only MVP guard (plan §8 invariant #9). Prevents activating
-- integration for a non-MSK teacher until DST/floating-time defense
-- is shipped (deferred to post-MVP).
--
-- Implemented as trigger because CHECK can't reference another table.
-- Fires only on state transition into active/degraded.
create or replace function teacher_calendar_integrations_msk_only_check()
returns trigger language plpgsql as $$
declare
  acc_tz text;
begin
  if new.sync_state in ('active', 'degraded') then
    select timezone into acc_tz
      from account_profiles
     where account_id = new.account_id;
    if acc_tz is null or acc_tz <> 'Europe/Moscow' then
      raise exception
        'teacher_calendar_integrations: MVP supports only Europe/Moscow teachers (account_id=%, timezone=%)',
        new.account_id, coalesce(acc_tz, '<null>')
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists teacher_calendar_integrations_msk_only_guard
  on teacher_calendar_integrations;
create trigger teacher_calendar_integrations_msk_only_guard
  before insert or update on teacher_calendar_integrations
  for each row execute function teacher_calendar_integrations_msk_only_check();

-- updated_at touch trigger — standard pattern.
create or replace function teacher_calendar_integrations_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists teacher_calendar_integrations_touch_updated_at_trg
  on teacher_calendar_integrations;
create trigger teacher_calendar_integrations_touch_updated_at_trg
  before update on teacher_calendar_integrations
  for each row execute function teacher_calendar_integrations_touch_updated_at();

comment on table teacher_calendar_integrations is
  'BCS-A.2 — per-teacher Google Calendar integration state. Tokens encrypted via CALENDAR_ENCRYPTION_KEY. Plan: docs/plans/booking-calendly-style.md §3.2.';
comment on column teacher_calendar_integrations.epoch is
  'Rotated on connect/reconnect. Stamped onto lesson_slots.integration_epoch at create push success; mismatch surfaces as orphan-self in F8 UI.';
comment on column teacher_calendar_integrations.last_reconnected_at is
  'F9 gate: reconcile may re-enqueue terminal_failure delete ONLY when this is newer than the job last_attempt_at.';
comment on column teacher_calendar_integrations.channel_token is
  'Per-subscription HMAC for X-Goog-Channel-Token verification. 32-byte random, single-purpose, high-entropy.';
