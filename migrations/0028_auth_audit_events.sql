-- Wave 5 (security observability) — auth-domain audit log.
--
-- Why a separate table from payment_audit_events:
--
--   - payment_audit_events.invoice_id is NOT NULL with FK to
--     payment_orders. Auth events have no invoice context. Making the
--     FK nullable would weaken the payment-side guarantee.
--
--   - Different access patterns: auth security analytics index by
--     email_hash + time ("all login attempts on this email") and by
--     ip + time ("all auth activity from this IP"). Payment side
--     indexes by invoice_id and account_id.
--
--   - Different retention: auth events tend to be retained shorter
--     (180 days here) because slow-brute-force pattern matching does
--     not need 3-year history. Payment events stay 3 years for 152-FZ
--     financial-record alignment.
--
-- What this closes:
--
--   Without an auth audit log, slow brute-force attacks were
--   invisible. The IP rate limit (10/min) and per-email limit (5/min)
--   bound the rate but a patient attacker pacing under both leaves no
--   trace beyond raw nginx access logs. This table is the structured
--   query surface for "show me failed login attempts on email X over
--   the last hour" and "show me failed logins from IP Y across all
--   accounts in the last 24h".
--
-- Privacy:
--
--   email_hash is the HMAC-SHA256 of normalized email under
--   AUTH_RATE_LIMIT_SECRET (already used for rate-limiting buckets).
--   We deliberately DO NOT store raw email here:
--
--     - Rate-limit and brute-force pattern matching only need stable
--       per-email identity, not the email itself.
--     - Email leak via this table is now meaningless without the
--       AUTH_RATE_LIMIT_SECRET — operator can rotate the secret if
--       suspected compromised, breaking the link.
--
--   client_ip is stored plaintext for now. The same encryption-at-rest
--   pattern as payment_audit_events (Wave 2.1) can apply later if the
--   threat model demands it.
--
-- Failure mode: writes are best-effort. The recorder catches and
-- swallows exceptions; an outage of audit must never block login.
-- A swallowed exception surfaces as `[auth-audit]` in journalctl.

create table if not exists auth_audit_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  event_type text not null check (event_type in (
    'auth.login.success',
    'auth.login.failed',
    'auth.register.created',
    'auth.reset.requested',
    'auth.reset.confirmed',
    'auth.verify.success',
    'auth.session.revoked'
  )),

  -- Nullable: failed login on an unknown email has no account to
  -- attach to. Successful login + register always set this.
  account_id uuid null
    references accounts(id) on delete set null,

  -- HMAC-keyed sha256 of the normalized email. Stable per-email
  -- identity for analytics + alerting; unrecoverable to plaintext
  -- without AUTH_RATE_LIMIT_SECRET. Always set on the login / reset
  -- paths because we always have the email parameter at that point.
  email_hash text not null,

  client_ip text null,
  user_agent text null,

  -- Free-form per-event details. Examples:
  --   { "reason": "unknown_email" }       — login.failed (anti-enum
  --                                         signal kept INTERNAL —
  --                                         the response stays generic)
  --   { "reason": "wrong_password" }     — login.failed
  --   { "reason": "disabled_account" }   — login.failed
  payload jsonb not null default '{}'::jsonb
);

-- "all attempts on this email over the last hour" — primary alert query.
create index if not exists auth_audit_events_email_time_idx
  on auth_audit_events (email_hash, created_at desc);

-- "all auth activity from this IP across all accounts" — IP brute-force.
create index if not exists auth_audit_events_ip_time_idx
  on auth_audit_events (client_ip, created_at desc)
  where client_ip is not null;

-- "what failed in the last hour" — sweep query for the alert cron.
create index if not exists auth_audit_events_type_time_idx
  on auth_audit_events (event_type, created_at desc);

-- Per-account history: "show me everything that happened to my account".
create index if not exists auth_audit_events_account_idx
  on auth_audit_events (account_id, created_at desc)
  where account_id is not null;
