-- 0125_lesson_slots_minute_start.sql
-- minute-start epic (2026-06-11), Sub-PR A.1.
--
-- Drops the 30-min start_at alignment CHECK so teacher and learner can
-- schedule lessons with minute precision (e.g. 10:13). Existing rows
-- with start_at on the :00/:30 boundary continue to satisfy the
-- relaxed `seconds_zero` invariant (subset preservation).
--
-- Why drop entirely instead of relaxing: owner ask 2026-06-11 — "точное
-- время до минут везде". The 30-min grid was a UX simplification, not a
-- domain invariant. The pull/push Google Calendar workers, conflict
-- detector, and booking pipeline already operate on absolute timestamps;
-- they are agnostic to minute alignment.

do $$
begin
  if exists (
    select 1 from pg_constraint where conname = 'lesson_slots_start_30min_aligned'
  ) then
    alter table lesson_slots drop constraint lesson_slots_start_30min_aligned;
  end if;
end $$;

-- Replace with a sanity-only check (seconds=0). Postgres timestamptz can
-- hold sub-second precision; we forbid that to keep ordering + diff math
-- predictable. The MSK band check (lesson_slots_start_in_business_hours)
-- continues to enforce 06:00-22:00 window.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'lesson_slots_start_seconds_zero'
  ) then
    alter table lesson_slots
      add constraint lesson_slots_start_seconds_zero
      check (extract(second from (start_at at time zone 'Europe/Moscow')) = 0);
  end if;
end $$;
