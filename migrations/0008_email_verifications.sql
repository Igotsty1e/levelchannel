-- Single-use verify-email tokens. TTL is enforced at use time. Tokens
-- are sha256-hashed in storage, like sessions. consumed_at is set
-- atomically when the token is exchanged so a replay returns the same
-- "invalid or already used" message.

create table if not exists email_verifications (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  token_hash text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz null,
  created_at timestamptz not null default now()
);

create unique index if not exists email_verifications_token_hash_unique
  on email_verifications (token_hash);

create index if not exists email_verifications_account_idx
  on email_verifications (account_id, created_at desc);
