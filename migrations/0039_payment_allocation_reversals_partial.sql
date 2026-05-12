-- Refund Phase 7 follow-up: support partial reversals.
--
-- Stage A (migration 0036) added a UNIQUE(payment_order_id, kind,
-- target_id) constraint so one allocation could carry at most one
-- reversal row. That fit the v1 "full-refund-only" stance. The
-- follow-up loosens it: allow multiple reversal rows per allocation,
-- read paths SUM `refunded_kopecks` and compare against
-- `payment_allocations.amount_kopecks` to decide "is this slot
-- effectively still paid?". A partial refund where SUM < amount keeps
-- the slot in the paid bucket; a series of partials whose SUM >=
-- amount flips it to refunded.
--
-- Drop the unique index. Replace with a plain (composite) lookup index
-- so the per-allocation aggregate stays fast.

drop index if exists payment_allocation_reversals_alloc_unique;

create index if not exists payment_allocation_reversals_alloc_lookup_idx
  on payment_allocation_reversals (payment_order_id, kind, target_id);
