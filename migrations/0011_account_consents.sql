-- Normalized audit trail for every consent acceptance event. One row
-- per acceptance — register inserts personal_data, future surfaces add
-- offer / marketing-opt-in / parent-consent / new-version-of-policy
-- without schema changes.
--
-- This is NOT accounts.metadata jsonb (per /plan-eng-review D2): jsonb
-- collapses history into "last snapshot" and breaks queries like
-- "who accepted offer v3 in the last 30 days". A row-per-event table
-- keeps history in a queryable shape.

create table if not exists account_consents (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  document_kind text not null check (document_kind in (
    'personal_data',
    'offer',
    'marketing_opt_in',
    'parent_consent'
  )),
  document_version text not null,
  document_path text null,
  accepted_at timestamptz not null default now(),
  ip text null,
  user_agent text null,
  created_at timestamptz not null default now()
);

create index if not exists account_consents_account_idx
  on account_consents (account_id, accepted_at desc);

create index if not exists account_consents_kind_version_idx
  on account_consents (document_kind, document_version);
