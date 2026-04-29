-- Session storage. We hand the client a random opaque token via cookie;
-- the database only stores its sha256, never the plaintext. revoked_at
-- supports per-device sign-out and the "sign out everywhere on password
-- reset" rule.

create table if not exists account_sessions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  token_hash text not null,
  expires_at timestamptz not null,
  revoked_at timestamptz null,
  ip text null,
  user_agent text null,
  created_at timestamptz not null default now()
);

create unique index if not exists account_sessions_token_hash_unique
  on account_sessions (token_hash);

create index if not exists account_sessions_account_expires_idx
  on account_sessions (account_id, expires_at desc);
