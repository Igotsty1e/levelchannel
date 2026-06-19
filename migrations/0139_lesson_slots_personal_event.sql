-- mig 0139 — Epic B: «Дела» (personal events) учителя (2026-06-19).
--
-- Plan: docs/plans/clever-sprouting-floyd.md Epic B.
--
-- Дело учителя — третий тип занятости расписания (помимо open / booked
-- уроков). Тихо блокирует слот, ученики его не видят. Жизненный цикл:
-- open → completed / cancelled (ручное «выполнить» / «отмена»). Хранится
-- в той же lesson_slots — single source of truth для advisory-lock,
-- conflict detection, Google Calendar push.
--
-- Schema additions:
--   - status enum: добавлен 'personal_event' (активное дело). Терминальные
--     состояния «выполнено» / «отменено» мапятся на 'completed' / 'cancelled'
--     (используем существующие enum-значения; UI различает дело vs урок
--     по source='personal_event' в истории).
--   - source enum (mig 0122): добавлен 'personal_event'.
--   - personal_event_title varchar(80) null — заголовок дела.
--   - personal_event_body text null check len<=2000 — заметка.
--   - Инварианты:
--     * source='personal_event' → status ∈ ('personal_event','completed','cancelled')
--                                AND learner_account_id IS NULL
--                                AND personal_event_title IS NOT NULL
--     * source != 'personal_event' → personal_event_title/body должны быть NULL
--
-- Idempotent — все операции через ALTER ... ADD/DROP CONSTRAINT с гардом.

-- (1) Расширить status enum.
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
    'no_show_teacher',
    'personal_event'
  ));

-- (2) Расширить source enum (mig 0122).
alter table lesson_slots
  drop constraint if exists lesson_slots_source_check;

alter table lesson_slots
  add constraint lesson_slots_source_check
  check (source is null or source in ('open_slot', 'direct_assign', 'personal_event'));

-- (3) Колонки для title + body.
alter table lesson_slots
  add column if not exists personal_event_title varchar(80) null;

alter table lesson_slots
  add column if not exists personal_event_body text null;

do $migration$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'lesson_slots_personal_event_body_len_chk'
  ) then
    alter table lesson_slots
      add constraint lesson_slots_personal_event_body_len_chk
      check (personal_event_body is null or char_length(personal_event_body) <= 2000);
  end if;
end
$migration$;

-- (4) Source/personal-fields invariants. source='personal_event' ⇒ title NOT NULL
--     и learner_account_id IS NULL. source != 'personal_event' ⇒ title/body NULL.
do $migration$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'lesson_slots_personal_event_source_invariants'
  ) then
    alter table lesson_slots
      add constraint lesson_slots_personal_event_source_invariants
      check (
        case when source = 'personal_event' then
          status in ('personal_event', 'completed', 'cancelled')
          and learner_account_id is null
          and personal_event_title is not null
        else
          personal_event_title is null
          and personal_event_body is null
        end
      );
  end if;
end
$migration$;

-- (5) Partial index для быстрого фильтра дел учителя в истории.
create index if not exists lesson_slots_personal_event_idx
  on lesson_slots (teacher_account_id, start_at desc)
  where source = 'personal_event';

comment on column lesson_slots.personal_event_title is
  'Дело учителя (Epic B 2026-06-19) — заголовок. NOT NULL когда source=personal_event.';
comment on column lesson_slots.personal_event_body is
  'Дело учителя — заметка (≤2000 симв.). NULL допустимо.';
