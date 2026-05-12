-- Wave 60 follow-up (Codex HIGH #2 — partial-success recovery).
--
-- Durable two-phase record of every gateway-initiated refund call.
-- The endpoint writes the attempt row BEFORE the CP API call so that
-- a crash between "CP says success" and "our reversal is booked"
-- doesn't leave the bank refund without any DB record. A reconcile
-- job (or the future CP `Refund` webhook handler) walks attempts in
-- terminal=false state, asks CP for the canonical state of the
-- gateway_transaction_id (or trusts the cached one), and either
-- finalizes the reversal or marks the attempt as failed.
--
-- Status taxonomy:
--   pending      — row written, CP call not yet returned
--   succeeded    — CP returned Success=true AND reversal row booked
--   gateway_succeeded_db_failed — CP success but our follow-up DB
--                                 work (reversal insert or commit)
--                                 errored. Reconcile target.
--   declined     — CP returned Success=false (no money moved)
--   error        — fetch / network / malformed response. Money state
--                  on the gateway is unknown until reconcile.
--
-- Idempotency key: optional; when present the same (operator,
-- idempotency_key) pair must not be inserted twice (UNIQUE index).
-- Empty/null idempotency_key means the caller didn't opt in — that
-- mode allows multiple attempts and the operator owns the dedup.

create table if not exists payment_refund_attempts (
  id uuid primary key default gen_random_uuid(),
  -- Composite reference to the target allocation. Not a FK because
  -- allocations may be soft-deleted in the future, and the attempt
  -- row is the historical record either way.
  payment_order_id text not null,
  kind text not null check (kind in ('lesson_slot', 'package')),
  target_id text not null,
  -- Amount the operator asked for. May be partial.
  refunded_kopecks bigint not null check (refunded_kopecks > 0),
  -- Operator that triggered the attempt.
  operator_account_id uuid not null references accounts(id) on delete restrict,
  -- Optional client-side dedup. NULL = no idempotency requested.
  idempotency_key text null,
  -- Status as above.
  status text not null check (status in (
    'pending',
    'succeeded',
    'gateway_succeeded_db_failed',
    'declined',
    'error'
  )),
  -- CP's TransactionId of the original captured payment (the one we
  -- send in to refund). Captured pre-call so the row carries enough
  -- info to reconcile even if the call itself crashed before
  -- returning a body.
  original_transaction_id text not null,
  -- CP's TransactionId of the refund operation, populated on
  -- success / gateway_succeeded_db_failed. Null on pending / decline / error.
  gateway_refund_transaction_id text null,
  -- The reversal row this attempt landed in (succeeded only). Null
  -- when the attempt didn't materialize a reversal. Composite-FK in
  -- spirit — no formal FK because payment_allocation_reversals uses
  -- a composite key, not the id directly. The id column is the row's
  -- canonical surrogate.
  reversal_id uuid null,
  -- Free-form reason from the operator (≤500 chars, mirrors the
  -- manual endpoint).
  reason text null check (reason is null or char_length(reason) <= 500),
  -- Last gateway message for failure diagnostics.
  gateway_message text null,
  gateway_reason_code text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Idempotency uniqueness. Two non-null keys from the same operator
-- collide; non-idempotent attempts (null key) coexist freely.
create unique index if not exists payment_refund_attempts_idempotency_unique
  on payment_refund_attempts (operator_account_id, idempotency_key)
  where idempotency_key is not null;

-- Reconcile lookup — walk non-terminal attempts oldest first.
create index if not exists payment_refund_attempts_reconcile_idx
  on payment_refund_attempts (status, created_at)
  where status in ('pending', 'gateway_succeeded_db_failed', 'error');

-- Per-allocation history (operator audit / sum cross-check).
create index if not exists payment_refund_attempts_allocation_idx
  on payment_refund_attempts (payment_order_id, kind, target_id, created_at);
