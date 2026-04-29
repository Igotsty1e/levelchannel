-- Mirrors lib/telemetry/store-postgres.ts ensureTelemetrySchemaPostgres().
-- Privacy-friendly checkout funnel events: email is HMAC-hashed via
-- TELEMETRY_HASH_SECRET and IP is /24-masked before insert.

create table if not exists payment_telemetry (
  id bigserial primary key,
  at timestamptz not null,
  type text not null,
  invoice_id text null,
  amount_rub numeric(12, 2) null,
  email_domain text null,
  email_hash text null,
  email_valid boolean null,
  reason text null,
  message text null,
  path text null,
  user_agent text null,
  ip text null
);

create index if not exists payment_telemetry_at_idx
  on payment_telemetry (at desc);

create index if not exists payment_telemetry_type_idx
  on payment_telemetry (type);
