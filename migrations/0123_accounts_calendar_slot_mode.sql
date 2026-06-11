-- 0123_accounts_calendar_slot_mode.sql
-- teacher-no-slots-mode epic (Задача 2.1), Sub-PR A.
--
-- Adds a per-account calendar slot-mode discriminator. Two values:
--   'open_slots'    — learners pick from teacher's open slots (default).
--   'direct_assign' — teacher assigns specific time per learner, learner
--                     doesn't see a pickup UI. Mode-aware UI hides
--                     pickup section + create-slots buttons accordingly.
--
-- Default 'open_slots' preserves current behaviour for everyone. Only
-- teachers who flip the toggle in /teacher/settings/calendar get the
-- new mode.
--
-- Backward compat: column is NOT NULL with default. Existing rows get
-- default. No backfill needed.

alter table accounts
  add column if not exists calendar_slot_mode text not null default 'open_slots';

alter table accounts
  drop constraint if exists accounts_calendar_slot_mode_check;
alter table accounts
  add constraint accounts_calendar_slot_mode_check
  check (calendar_slot_mode in ('open_slots', 'direct_assign'));

comment on column accounts.calendar_slot_mode is
  'How the teacher schedules lessons: open_slots (learners pick from open slots, default) | direct_assign (teacher assigns concrete time per learner, learner UI hides pickup).';
