-- 2026-06-17 — per-teacher cancel window (в минутах, 0..2880 = до 48ч).
--
-- Owner-feedback: «Нужно сделать настройку доступности отмены занятия
-- без оплаты — сейчас у нас хардкод 24 часа. Но нужно сделать так
-- чтобы учитель мог сам выбрать, какое время можно указать как время
-- с платной отменой. Давай дадим указать от 0 до 48 часов (включая
-- минуты)».
--
-- Семантика: если ученик отменяет занятие позже чем `start_at - N
-- минут`, считается «поздняя отмена» (платная). По умолчанию 1440
-- (=24h) — match с предыдущим POLICY-KNOBS env-default
-- LEARNER_CANCEL_WINDOW_HOURS.

alter table accounts
  add column if not exists teacher_cancel_window_minutes
    integer not null default 1440;

-- Гарантируем 0..2880 (0h..48h) на стороне БД — защита от UI-баг'а.
alter table accounts
  drop constraint if exists teacher_cancel_window_minutes_range;
alter table accounts
  add constraint teacher_cancel_window_minutes_range
    check (teacher_cancel_window_minutes >= 0
       and teacher_cancel_window_minutes <= 2880);

comment on column accounts.teacher_cancel_window_minutes is
  '2026-06-17 — per-teacher cancel-window в минутах (0..2880, default 1440=24h). '
  'Учитель управляет через /teacher/settings/cancel-policy. Cancel write '
  'paths (lib/scheduling/slots/mutations-cancel.ts) читают per-teacher '
  'значение; env LEARNER_CANCEL_WINDOW_HOURS остаётся как global default '
  'для accounts без явного значения.';
