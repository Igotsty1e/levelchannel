-- Mirrors lib/payments/store-postgres.ts ensureSchema(). Idempotent so that
-- a database already running on the legacy implicit schema applies cleanly
-- with no diff.

create table if not exists payment_orders (
  invoice_id text primary key,
  amount_rub numeric(12, 2) not null,
  currency text not null,
  description text not null,
  provider text not null,
  status text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  paid_at timestamptz null,
  failed_at timestamptz null,
  provider_transaction_id text null,
  provider_message text null,
  customer_email text not null,
  receipt_email text not null,
  receipt jsonb not null,
  metadata jsonb null,
  mock_auto_confirm_at timestamptz null,
  events jsonb not null default '[]'::jsonb
);
