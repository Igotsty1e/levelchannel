-- mig 0119 — self-hosted product analytics: events table.
--
-- See docs/analytics/identification.md for full design + identity-merge contract.
--
-- Schema highlights:
--   - wide JSONB events table partitioned monthly (cheap retention via DROP PARTITION)
--   - composite PK (occurred_at, event_id) — required by RANGE partitioning
--   - HMAC-signed anonymous_id (sig verified server-side; cookie spec
--     lives in lib/analytics/server.ts)
--   - account_id nullable + FK ON DELETE SET NULL (preserves anonymous
--     funnels even after account purge per 152-ФЗ delete request)
--   - 6 partitions pre-created (current + 5 ahead); ensure_event_partition_exists()
--     called from levelchannel-events-partition-create.timer (daily)
--
-- All CREATE statements are IF NOT EXISTS — idempotent re-run safe.

create extension if not exists "pgcrypto";

create table if not exists events (
  occurred_at  timestamptz not null,
  event_id     uuid not null default gen_random_uuid(),
  received_at  timestamptz not null default now(),
  event_name   text not null,
  anonymous_id uuid not null,
  account_id   uuid references accounts(id) on delete set null,
  session_id   uuid not null,
  url          text,
  referrer     text,
  utm          jsonb not null default '{}'::jsonb,
  ua_family    text,
  ua_os        text,
  ua_device    text,
  ip_prefix    inet,
  geo_country  text,
  properties   jsonb not null default '{}'::jsonb,
  primary key (occurred_at, event_id)
) partition by range (occurred_at);

-- Pre-create partitions for the next 6 months.
do $part$
declare
  v_month_start date := date_trunc('month', now())::date;
  v_partition_name text;
  v_range_start date;
  v_range_end date;
  i int;
begin
  for i in 0..5 loop
    v_range_start := v_month_start + (i || ' months')::interval;
    v_range_end := v_month_start + ((i+1) || ' months')::interval;
    v_partition_name := 'events_' || to_char(v_range_start, 'YYYY_MM');

    execute format(
      'create table if not exists %I partition of events for values from (%L) to (%L)',
      v_partition_name, v_range_start, v_range_end
    );

    -- Per-partition indexes (mig pattern: indexes go on each partition,
    -- not on the parent — Postgres limitation pre-15 was strict; PG16
    -- supports parent-level indexes but per-partition gives more flexibility).
    execute format(
      'create index if not exists %I on %I (anonymous_id, occurred_at desc)',
      v_partition_name || '_anon_idx', v_partition_name
    );
    execute format(
      'create index if not exists %I on %I (account_id, occurred_at desc) where account_id is not null',
      v_partition_name || '_acc_idx', v_partition_name
    );
    execute format(
      'create index if not exists %I on %I (event_name, occurred_at desc)',
      v_partition_name || '_name_idx', v_partition_name
    );
    execute format(
      'create index if not exists %I on %I using gin (properties jsonb_path_ops)',
      v_partition_name || '_props_idx', v_partition_name
    );
    execute format(
      'create index if not exists %I on %I using gin (utm jsonb_path_ops)',
      v_partition_name || '_utm_idx', v_partition_name
    );
  end loop;
end
$part$;

-- Helper called from levelchannel-events-partition-create.timer.
-- Ensures partitions for the next N months exist. Idempotent.
create or replace function ensure_event_partition_exists(p_months_ahead int default 3)
returns void
language plpgsql
as $fn$
declare
  v_month_start date := date_trunc('month', now())::date;
  v_partition_name text;
  v_range_start date;
  v_range_end date;
  i int;
begin
  for i in 0..p_months_ahead loop
    v_range_start := v_month_start + (i || ' months')::interval;
    v_range_end := v_month_start + ((i+1) || ' months')::interval;
    v_partition_name := 'events_' || to_char(v_range_start, 'YYYY_MM');

    execute format(
      'create table if not exists %I partition of events for values from (%L) to (%L)',
      v_partition_name, v_range_start, v_range_end
    );
    execute format(
      'create index if not exists %I on %I (anonymous_id, occurred_at desc)',
      v_partition_name || '_anon_idx', v_partition_name
    );
    execute format(
      'create index if not exists %I on %I (account_id, occurred_at desc) where account_id is not null',
      v_partition_name || '_acc_idx', v_partition_name
    );
    execute format(
      'create index if not exists %I on %I (event_name, occurred_at desc)',
      v_partition_name || '_name_idx', v_partition_name
    );
    execute format(
      'create index if not exists %I on %I using gin (properties jsonb_path_ops)',
      v_partition_name || '_props_idx', v_partition_name
    );
    execute format(
      'create index if not exists %I on %I using gin (utm jsonb_path_ops)',
      v_partition_name || '_utm_idx', v_partition_name
    );
  end loop;
end
$fn$;

comment on table events is
  'Self-hosted product analytics events. Wide JSONB schema (см. docs/analytics/identification.md). '
  'anonymous_id всегда установлен (cookie lc_aid с HMAC). account_id nullable до identify. '
  'Партиция по месяцу — для cheap retention. Запросы ВСЕГДА с WHERE occurred_at >= X для pruning.';

comment on column events.anonymous_id is
  'HMAC-signed UUID из cookie lc_aid. Сигнатура верифицируется server-side. См. lib/analytics/server.ts.';

comment on column events.account_id is
  'Установлен на signup/login через linkAnonymousIdToAccount(). NULL до identify. '
  'ON DELETE SET NULL — события сохраняются для агрегатов после удаления аккаунта (152-ФЗ scrub).';

comment on column events.properties is
  'Event-specific data. Schema enforced via Zod в lib/analytics/registry.ts. '
  'PII-allowlist: НЕ хранить email/phone/name/payment/free-text.';

comment on function ensure_event_partition_exists is
  'Создаёт партиции для p_months_ahead вперёд. Вызывается из levelchannel-events-partition-create.timer ежедневно.';
