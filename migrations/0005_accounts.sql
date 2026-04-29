-- Identity table for the cabinet contract. The guest checkout on the
-- landing page never touches accounts; legacy payment_orders stay
-- unlinked (account_id NULL). New cabinet flows will populate
-- account_id when payment_orders gains it (later migration).
--
-- Email is stored normalized lower-case at the application layer; the
-- UNIQUE constraint enforces case-sensitive uniqueness on the already
-- normalized value. We do not depend on the citext extension.
--
-- Postgres 16 ships gen_random_uuid() built-in; no extension needed.

create table if not exists accounts (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  password_hash text not null,
  email_verified_at timestamptz null,
  disabled_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists accounts_email_unique
  on accounts (email);
