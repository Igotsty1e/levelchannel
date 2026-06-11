-- 0124_lesson_slots_notify_pending.sql
-- teacher-no-slots-mode epic (Задача 2.1), Sub-PR C.
--
-- Adds a `notify_pending` flag on lesson_slots used by the direct-assign
-- digest cron. When teacher direct-assigns >5 slots/hour to one learner,
-- the per-event email rate-limit fires and we set notify_pending=true
-- instead of silent-skipping. The hourly cron groups pending rows by
-- learner and sends one digest email instead of N individual ones.
--
-- Partial index lets the cron query find ready rows efficiently
-- (WHERE notify_pending = true is a small subset).

alter table lesson_slots
  add column if not exists notify_pending boolean not null default false;

create index if not exists lesson_slots_notify_pending_idx
  on lesson_slots (learner_account_id, start_at)
  where notify_pending = true;

comment on column lesson_slots.notify_pending is
  'true = direct-assign created this slot but per-event email was rate-limited; hourly digest cron picks it up.';
