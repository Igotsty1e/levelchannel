-- Mirrors lib/security/idempotency-postgres.ts ensureIdempotencySchemaPostgres().
-- Body-hash dedup for money-moving routes (POST /api/payments,
-- POST /api/payments/charge-token). 5xx responses are not cached so transient
-- infra failures stay retriable. Stale rows are pruned periodically (operator
-- runbook: OPERATIONS.md §11).

create table if not exists idempotency_records (
  scope text not null,
  key text not null,
  request_hash text not null,
  response_status int not null,
  response_body jsonb not null,
  created_at timestamptz not null default now(),
  primary key (scope, key)
);

create index if not exists idempotency_records_created_at_idx
  on idempotency_records (created_at);
