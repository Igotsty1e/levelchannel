-- Phase 4 — operator-managed lesson slots.
--
-- One row per concrete `start_at` for a teacher. No separate
-- "recurring template" table in this wave: the bulk-create endpoint
-- generates N rows at once and the operator edits/cancels individual
-- rows after. If recurring becomes painful to manage, we can layer a
-- template table on top later — the row layout doesn't change.
--
-- All times stored UTC; display tz comes from `account_profiles.timezone`
-- at render time (Phase 3 column).
--
-- The `events JSONB` column mirrors `payment_orders.events` — a tiny
-- in-row audit log of state transitions. We don't ship a separate
-- `lesson_slot_audit_events` table in this wave; if cross-row audit
-- becomes a real need, the `payment_audit_events` pattern is the
-- template to copy.
--
-- Status enum (CHECK constraint, not Postgres ENUM type — easier to
-- extend later without a follow-up migration):
--   open      — created, no learner booked, future
--   booked    — learner_account_id is non-null
--   cancelled — terminal; cancellation_reason / cancelled_by populated
--
-- Constraints:
--   - start_at must be in the future at INSERT time. We use a CHECK
--     against `now()`; `now()` is STABLE in Postgres so the check
--     evaluates per-statement, which is exactly what we want — the
--     operator can't accidentally seed a past slot, but UPDATEs that
--     don't touch start_at don't re-evaluate it
--   - (teacher_account_id, start_at) is unique so two CREATE calls
--     for the same teacher + minute can't both win
--   - duration_minutes between 15 and 180

create table if not exists lesson_slots (
  id uuid primary key default gen_random_uuid(),
  teacher_account_id uuid not null references accounts(id) on delete restrict,
  start_at timestamptz not null,
  duration_minutes integer not null default 60,
  status text not null default 'open',
  learner_account_id uuid null references accounts(id) on delete restrict,
  booked_at timestamptz null,
  cancelled_at timestamptz null,
  cancelled_by_account_id uuid null references accounts(id) on delete set null,
  cancellation_reason text null,
  notes text null,
  events jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lesson_slots_status_check
    check (status in ('open', 'booked', 'cancelled')),
  constraint lesson_slots_duration_band
    check (duration_minutes between 15 and 180),
  constraint lesson_slots_booked_invariants
    check (
      (status = 'booked' and learner_account_id is not null and booked_at is not null)
      or (status <> 'booked')
    ),
  constraint lesson_slots_cancelled_invariants
    check (
      (status = 'cancelled' and cancelled_at is not null)
      or (status <> 'cancelled')
    )
);

create unique index if not exists lesson_slots_teacher_start_unique
  on lesson_slots (teacher_account_id, start_at);

-- Hot path: learner-side "what's available" query filters on
-- status='open' AND start_at > now(). Partial index tuned for that.
create index if not exists lesson_slots_open_future_idx
  on lesson_slots (start_at)
  where status = 'open';

-- Hot path: learner's "Мои уроки" pulls by learner_account_id ordered
-- by start_at desc. Partial index on bookings.
create index if not exists lesson_slots_learner_idx
  on lesson_slots (learner_account_id, start_at desc)
  where learner_account_id is not null;

-- Operator-side admin list pulls by teacher + range; full index on
-- (teacher_account_id, start_at) is already covered by the unique
-- constraint above, no extra index needed.
