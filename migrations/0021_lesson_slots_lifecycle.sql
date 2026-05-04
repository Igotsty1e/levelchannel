-- Phase 5 — extend lesson_slots with lifecycle states.
--
-- Adds three new statuses ('completed', 'no_show_learner',
-- 'no_show_teacher') and a `marked_at` timestamp column for when the
-- lifecycle status was set (auto-complete cron stamps it; operator
-- "mark" endpoint stamps it; the booked → completed/no_show
-- transition is the only path that touches marked_at, leaves it null
-- on open / cancelled rows).
--
-- The booked / cancelled invariants from migration 0020 stay; a row
-- in `completed` / `no_show_*` retains its `learner_account_id` and
-- `booked_at` because those describe a real attended-or-not lesson.
--
-- Drop+add the CHECK constraint inside the same transaction (the
-- migrate runner wraps each migration in BEGIN/COMMIT, so no row can
-- be observed under a partial enum).

alter table lesson_slots
  drop constraint if exists lesson_slots_status_check;

alter table lesson_slots
  add constraint lesson_slots_status_check
  check (status in (
    'open',
    'booked',
    'cancelled',
    'completed',
    'no_show_learner',
    'no_show_teacher'
  ));

alter table lesson_slots
  add column if not exists marked_at timestamptz null;
