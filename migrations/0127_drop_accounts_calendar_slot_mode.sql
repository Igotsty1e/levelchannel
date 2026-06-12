-- 0127_drop_accounts_calendar_slot_mode.sql
-- teacher-calendar-unify epic (2026-06-12).
--
-- Removes the per-account calendar slot-mode discriminator added in
-- 0123_accounts_calendar_slot_mode.sql. The flag was UI-only — API
-- endpoints (/api/teacher/slots/bulk-create + assign-direct) never
-- gated on it. Top-row in /teacher/calendar now shows both
-- «+ Назначить ученику» and «+ Добавить слоты» buttons unconditionally
-- on all viewports.

alter table accounts
  drop constraint if exists accounts_calendar_slot_mode_check;

alter table accounts
  drop column if exists calendar_slot_mode;
