-- Wave 14 #1 — make (teacher_account_id, start_at) unique only for
-- non-cancelled rows. Before this migration, cancelling a slot left
-- the row in lesson_slots with status='cancelled' AND the unique
-- index still consumed the (teacher, start_at) cell, so creating a
-- new slot at the same time blocked with a 23505 conflict. The
-- operator workflow "I made a slot, I cancelled it, now I can't put
-- a slot back at the same time" was broken.
--
-- Fix: drop the full UNIQUE and replace with a partial UNIQUE that
-- only enforces uniqueness on rows where status <> 'cancelled'.
-- Cancelled rows are kept for audit trail (cancelled_at, events
-- jsonb log) but no longer occupy the time-slot lane.

drop index if exists lesson_slots_teacher_start_unique;

create unique index if not exists lesson_slots_teacher_start_unique
  on lesson_slots (teacher_account_id, start_at)
  where status <> 'cancelled';
