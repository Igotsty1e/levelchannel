-- 0122_lesson_slots_source.sql
-- Direct-assign epic (Задача 2.2).
--
-- Adds a `source` discriminator to lesson_slots so we can tell apart:
--   - 'open_slot'      — учитель создал открытый слот; ученик потом забронировал.
--   - 'direct_assign'  — учитель назначил занятие конкретному ученику напрямую.
--
-- Why we need this:
--   1. Cancel email копи различается («ваш учитель отменил занятие, которое вам назначил»
--      vs «слот, который вы забронировали, отменён»).
--   2. Analytics: сколько занятий приходит через self-pickup vs direct-assign.
--   3. Foundation для Задачи 2.1 (глобальный режим «без слотов»), где default'но всё
--      создаётся как direct_assign.
--
-- Backward compatibility:
--   - Column NULLABLE без backfill для existing rows. App-layer считает NULL = legacy
--     open-slot path. Forward writes (createSlot / assignSlotDirect) пишут non-NULL.
--   - SLOT_COLUMNS в lib/scheduling/slots/internal.ts добавляет колонку в SELECT;
--     rowToSlot маппит null → null (existing helpers пропускают undefined → null).

alter table lesson_slots
  add column if not exists source text;

alter table lesson_slots
  drop constraint if exists lesson_slots_source_check;
alter table lesson_slots
  add constraint lesson_slots_source_check
  check (source is null or source in ('open_slot', 'direct_assign'));

comment on column lesson_slots.source is
  'How the slot was created: open_slot (teacher created, learner booked) | direct_assign (teacher created already-booked for specific learner). NULL = legacy pre-0122 row, treated as open_slot.';
