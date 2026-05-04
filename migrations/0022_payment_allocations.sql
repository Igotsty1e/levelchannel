-- Phase 6 — payment_allocations + lesson_slots.tariff_id.
--
-- Additive only. Existing /pay free-amount flow is bit-for-bit
-- unchanged: it doesn't touch lesson_slots and it doesn't write
-- allocations, so the new column + table are invisible to it.
--
-- payment_allocations:
--   one row per "this much money was allocated against this thing".
--   Phase 6 only ships kind='lesson_slot'; the enum is set up to
--   take 'package' / 'subscription' later without a follow-up
--   migration in the worst case (one CHECK update).
--
--   primary key is (payment_order_id, kind, target_id) — a single
--   payment can be split across multiple targets (operator manually
--   marks "this 7000₽ payment covered slots A and B"), but two rows
--   for the same (order, kind, target) is meaningless and rejected.
--
--   amount_kopecks is non-negative; refunds (negative deltas) live
--   in a future Phase 7 refund table, not here.
--
--   payment_order_id references payment_orders(invoice_id) which is
--   the natural key (`lc_<18hex>`). FK ON DELETE CASCADE — if an
--   order row is ever physically deleted (today: never), the
--   allocations go with it.
--
-- lesson_slots.tariff_id:
--   nullable FK to pricing_tariffs(id). Operator picks the tariff at
--   slot-create time so the cabinet can show a price tag and link to
--   /checkout/<slug>?slot=<id>. Null means "no auto-bound price";
--   the slot is still bookable but cabinet will not surface a "pay"
--   action for it.
--
--   ON DELETE SET NULL — if a tariff is hard-deleted (today: only
--   archived via is_active=false, never deleted), existing slots
--   keep working with no tariff binding. We don't propagate the
--   delete to slots.

create table if not exists payment_allocations (
  payment_order_id text not null
    references payment_orders(invoice_id) on delete cascade,
  kind text not null,
  target_id text not null,
  amount_kopecks integer not null,
  created_at timestamptz not null default now(),
  primary key (payment_order_id, kind, target_id),
  constraint payment_allocations_kind_check
    check (kind in ('lesson_slot')),
  constraint payment_allocations_amount_nonneg
    check (amount_kopecks >= 0)
);

create index if not exists payment_allocations_target_idx
  on payment_allocations (kind, target_id);

alter table lesson_slots
  add column if not exists tariff_id uuid null
    references pricing_tariffs(id) on delete set null;

create index if not exists lesson_slots_tariff_idx
  on lesson_slots (tariff_id)
  where tariff_id is not null;
