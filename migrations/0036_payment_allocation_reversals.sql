-- Refund Phase 7, Stage A. payment_allocation_reversals.
--
-- Refunds today happen out-of-band: the operator hits the CloudPayments
-- dashboard, then manually flips `payment_orders.status='refunded'`.
-- That works for the trickle of one-off refunds we see now, but it
-- leaves us blind to two things the design v9 already wired pipes for:
--
--   1. `slotIsPaidByAllocations` does a CASE SUM expecting a future
--      `payment_allocation_reversals` LEFT JOIN with `r.id IS NULL`
--      (see lib/billing/paid-state.ts).
--   2. `package_consumptions.restored_at` is already in the schema for
--      the moment a package-allocation refund needs to put units back
--      on the package_purchase.
--
-- This table fills both pipes.
--
-- Schema decisions:
--
--   - One reversal per allocation. UNIQUE(payment_order_id, kind,
--     target_id). Partial / amount-only reversals are out of scope for
--     Stage A — they require the SUM-over-reversals refactor and have
--     no real demand yet.
--   - The reversal references the allocation through the composite key
--     (payment_order_id, kind, target_id), not via a surrogate UUID,
--     because payment_allocations (migration 0022) uses that composite
--     as its primary key. A composite FK matches and propagates ON
--     DELETE CASCADE from the order side cleanly (if an order is
--     deleted, both allocation and its reversal go).
--   - refunded_by_account_id → accounts(id) ON DELETE RESTRICT for
--     audit. The operator's account row IS the audit trail.
--   - refunded_kopecks must be > 0 (CHECK). On the WRITE side the admin
--     endpoint will assert it equals the allocation amount until partial
--     refunds ship.
--   - reason text, length capped 500 (mirrors slot cancellation_reason).
--   - created_at + refunded_at are separate. created_at = INSERT moment,
--     refunded_at = when the actual money movement happened (operator
--     supplies; defaults to now() if they don't pass one).

create table if not exists payment_allocation_reversals (
  id uuid primary key default gen_random_uuid(),
  payment_order_id text not null,
  kind text not null,
  target_id text not null,
  refunded_at timestamptz not null default now(),
  refunded_kopecks bigint not null check (refunded_kopecks > 0),
  refunded_by_account_id uuid not null references accounts(id) on delete restrict,
  reason text check (reason is null or length(reason) <= 500),
  created_at timestamptz not null default now(),
  -- Composite FK matches payment_allocations' composite PK; ON DELETE
  -- CASCADE so if the underlying order disappears (today: never) the
  -- reversal trail goes with it.
  constraint payment_allocation_reversals_alloc_fk
    foreign key (payment_order_id, kind, target_id)
    references payment_allocations(payment_order_id, kind, target_id)
    on delete cascade
);

-- One reversal per allocation. Partial refunds → future migration.
create unique index if not exists payment_allocation_reversals_alloc_unique
  on payment_allocation_reversals (payment_order_id, kind, target_id);

-- Operator audit lookup: who refunded what + when, ordered.
create index if not exists payment_allocation_reversals_by_actor_idx
  on payment_allocation_reversals (refunded_by_account_id, created_at desc);

-- Per-order reversal lookup. The admin payment detail page enumerates
-- reversals next to allocations.
create index if not exists payment_allocation_reversals_by_order_idx
  on payment_allocation_reversals (payment_order_id);
