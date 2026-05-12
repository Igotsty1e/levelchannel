-- Refund Phase 7 follow-up: support kind='package' refunds.
--
-- When a package allocation is refunded:
--   1. payment_allocation_reversals row lands (already supported by
--      Stage A, the route layer just needs to accept kind='package').
--   2. All active package_consumptions on the purchase are restored
--      (so any booked-from-package slot's "paid via package" backing
--      goes away — operator handles the downstream slot disposition).
--   3. The purchase row stays for audit, but the package becomes
--      void: consumePackageUnit must NOT pick it for future bookings.
--
-- Step 3 is what this column unlocks: a non-null `voided_at` excludes
-- the purchase from `consumePackageUnit`'s eligible-purchase query and
-- from `listAccountActivePackages`. The column is nullable (current
-- rows stay live).

alter table package_purchases
  add column if not exists voided_at timestamptz;

create index if not exists package_purchases_active_voided_idx
  on package_purchases (account_id) where voided_at is null;
