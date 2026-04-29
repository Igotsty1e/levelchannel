-- Single-use password-reset tokens. Same hashing rule as
-- email_verifications. Successful reset must also revoke every active
-- session for the account (sign-out everywhere) — that is enforced in
-- application code, not at the schema level.

create table if not exists password_resets (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  token_hash text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz null,
  created_at timestamptz not null default now()
);

create unique index if not exists password_resets_token_hash_unique
  on password_resets (token_hash);

create index if not exists password_resets_account_idx
  on password_resets (account_id, created_at desc);
