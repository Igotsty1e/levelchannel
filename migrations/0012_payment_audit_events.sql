-- Append-only audit log for critical payment lifecycle transitions.
--
-- Why this exists separately from payment_telemetry:
--   - `payment_telemetry` stores privacy-friendly checkout *funnel*
--     events: HMAC-hashed e-mail, /24-masked IP. Good for analytics,
--     useless for incident forensics ("which exact account, which exact
--     amount, which exact webhook payload").
--   - `payment_orders.events` jsonb is a snapshot of recent transitions
--     on the order itself, but it lives or dies with the order row, has
--     no per-event identity, and cannot be cross-queried by status,
--     actor, or time-window.
--   - This table is the audit-log-of-record. One row per transition,
--     full identity (real e-mail, full IP), structured columns for
--     invariants (event_type, invoice_id, amount), JSONB for variable
--     payload (3DS AcsUrl, decline reason, transaction id, etc.).
--
-- Retention: rows are immutable, kept ~3 years (152-FZ alignment for
-- financial records) and pruned via a future cron — not on schema. ON
-- DELETE NO ACTION on the order FK so audit can never disappear ahead
-- of the order itself.
--
-- Failure mode: writes are best-effort. The recorder catches and logs
-- exceptions but does NOT roll back the business transaction; an outage
-- of audit must never block a real payment.

create table if not exists payment_audit_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  -- The transition itself.
  event_type text not null check (event_type in (
    'order.created',
    'order.cancelled',
    'mock.confirmed',
    'webhook.check.received',
    'webhook.check.declined',
    'webhook.pay.received',
    'webhook.pay.processed',
    'webhook.pay.validation_failed',
    'webhook.fail.received',
    'charge_token.attempted',
    'charge_token.succeeded',
    'charge_token.requires_3ds',
    'charge_token.declined',
    'charge_token.error',
    'threeds.callback.received',
    'threeds.confirmed',
    'threeds.declined'
  )),

  -- Order identity. invoice_id matches payment_orders(invoice_id) but
  -- with ON DELETE NO ACTION: audit must outlive any future cleanup.
  invoice_id text not null
    references payment_orders(invoice_id) on delete no action,

  -- Account identity (nullable: guest checkout has no account).
  account_id uuid null
    references accounts(id) on delete set null,

  -- Real, unhashed identity. Audit needs query'able PII; access is
  -- admin-only and documented in SECURITY.md.
  customer_email text not null,
  client_ip text null,
  user_agent text null,

  -- Money snapshot at the moment of the event.
  amount_kopecks bigint not null,

  -- Status transition (nullable: not every event is a transition —
  -- e.g. webhook.check.received logs the *attempt* before validation).
  from_status text null,
  to_status text null,

  -- Caller / source.
  --   'user' — direct browser request from the customer
  --   'webhook:cloudpayments:<event>' — CP-server-to-our-server callback
  --   'admin' — manual op
  --   'cron' — scheduled job
  --   'system' — internal (e.g. mock confirm)
  actor text not null,

  -- Correlation hooks. idempotency_key is set for money-moving routes;
  -- request_id is reserved for future request-tracing.
  idempotency_key text null,
  request_id text null,

  -- Free-form per-event details (3DS AcsUrl, decline reason, CP
  -- transaction id, etc). Strict columns above carry invariants;
  -- payload carries the rest.
  payload jsonb not null default '{}'::jsonb
);

-- Lookup by order: "show me everything that happened to this invoice"
create index if not exists payment_audit_events_invoice_idx
  on payment_audit_events (invoice_id, created_at desc);

-- Lookup by account: "show me everything this account has done"
create index if not exists payment_audit_events_account_idx
  on payment_audit_events (account_id, created_at desc)
  where account_id is not null;

-- Time-window slice: "what failed in the last hour"
create index if not exists payment_audit_events_type_time_idx
  on payment_audit_events (event_type, created_at desc);
