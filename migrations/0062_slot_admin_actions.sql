-- BCS-DEF-2 — `slot_admin_actions` secondary operator-action audit
-- table for the /admin/slots/conflicts dashboard.
--
-- Plan: docs/plans/conflict-feed.md §3.2 (round-3 SIGN-OFF, 2026-05-19).
--
-- This table is a SECONDARY cross-action index. The canonical
-- operator-action audit lives in `lesson_slots.events` jsonb — populated
-- in-TX with the slot mutation by `cancelSlot()` / the dismiss-conflict
-- route. `slot_admin_actions` exists so the operator can answer
-- "show me every dismiss-conflict / cancel-from-conflict last week"
-- without scanning every slot's jsonb history.
--
-- Failure to INSERT into this table during the deploy-before-migrate
-- window (42P01) is recovered via SAVEPOINT in the dismiss-conflict
-- route and the cancel-from-conflict cleanup TX — the slot's events
-- jsonb stays canonical regardless. See plan §3.3 + §3.4.
--
-- §0a closures applied:
--   * action enum is exactly {'dismiss-conflict','cancel-from-conflict'};
--     'move-from-conflict' intentionally absent because the detector
--     only stamps booked slots and move is open-only — the path is
--     unreachable. If a future detector kind stamps open slots, add
--     the enum value here + the UI surface in a follow-up.
--   * `lesson_slots_external_conflict_admin_idx` partial index added
--     for the cross-teacher ORDER BY external_conflict_at DESC query
--     the admin dashboard runs. Predicate includes `status = 'booked'`
--     so cancelled-but-still-stamped rows don't pollute the index
--     (round-1 WARN#4 / BLOCKER#3 closure).

create table if not exists slot_admin_actions (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null references lesson_slots(id) on delete cascade,
  operator_account_id uuid not null references accounts(id) on delete restrict,
  action text not null check (action in (
    'dismiss-conflict',
    'cancel-from-conflict'
  )),
  reason text null,
  payload jsonb null,
  performed_at timestamptz not null default now()
);

create index if not exists slot_admin_actions_slot_idx
  on slot_admin_actions (slot_id, performed_at desc);

create index if not exists slot_admin_actions_operator_idx
  on slot_admin_actions (operator_account_id, performed_at desc);

-- §0a closure (round-1 WARN partial-index-coverage + BLOCKER#3): the
-- cross-teacher ORDER BY external_conflict_at DESC query in the admin
-- dashboard needs its own partial index. The migration 0042 partial
-- index serves the per-teacher banner query.
--
-- `status = 'booked'` in the predicate is load-bearing: without it,
-- cancelled-but-still-stamped rows accrete in the partial index over
-- time and degrade selectivity. The cancel-from-conflict cleanup TX
-- nulls the stamps proactively going forward, but the predicate is
-- the safety net for any cancelled-with-stamp rows that pre-date this
-- wave or were cancelled via a non-fromConflict path.
create index if not exists lesson_slots_external_conflict_admin_idx
  on lesson_slots (external_conflict_at desc)
  where external_conflict_at is not null
    and status = 'booked';

-- Round-3 WARN#4 closure — document the secondary-index semantics on
-- the table itself so future readers don't have to chase the plan doc
-- to understand why 42P01 here is recoverable.
comment on table slot_admin_actions is
  'Secondary operator-action audit ledger for conflict-feed dashboard '
  '(BCS-DEF-2, migration 0062). Canonical audit lives in '
  'lesson_slots.events jsonb; this table is a cross-action index for '
  'operator queries. Failures recovered via SAVEPOINT (dismiss-conflict '
  'route) or post-commit log+swallow (cancel-from-conflict cleanup TX). '
  'See docs/plans/conflict-feed.md.';
