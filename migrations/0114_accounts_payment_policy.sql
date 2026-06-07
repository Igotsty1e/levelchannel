-- teacher-payments-sbp-self-service Sub-PR D extras (2026-06-07).
--
-- Учительская политика по умолчанию:
--  - charge_on_no_show: считать ли долгом занятия со status='no_show_learner'
--  - charge_on_late_cancel: считать ли долгом отменённые позже 24ч
--
-- Default false — opt-in. Без этих флагов «Должны оплатить» считает
-- только booked (start_at <= now()) + completed.
--
-- Plan: docs/plans/teacher-payments-sbp-self-service.md §2.4

alter table accounts
  add column if not exists teacher_charge_on_no_show boolean not null default false;

alter table accounts
  add column if not exists teacher_charge_on_late_cancel boolean not null default false;
