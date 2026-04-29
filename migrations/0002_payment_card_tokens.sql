-- Mirrors lib/payments/store-postgres.ts ensureSchema(). One saved token per
-- normalized customer email. Account-level linkage will be added in a later
-- migration once accounts exist.

create table if not exists payment_card_tokens (
  customer_email text primary key,
  token text not null,
  card_last_four text null,
  card_type text null,
  card_exp_month text null,
  card_exp_year text null,
  created_at timestamptz not null,
  last_used_at timestamptz not null
);
