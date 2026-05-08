-- Wave A — calendar UI domain invariants. Three CHECK constraints
-- encode invariants the calendar UI relies on. All enforced at the
-- DB layer plus mirrored in route validation.
--
-- Embedded pre-flight: if any existing row violates any of the new
-- invariants, the migration fails LOUD with a descriptive error.
-- Stronger than "verified manually before merge" because the real
-- risk is dirty production data, and a fresh-DB integration test
-- can't see it. Pre-flight verified empty 2026-05-09 via SSH audit.
--
-- Each ALTER TABLE wrapped in a do-block that checks pg_constraint
-- first so re-runs are idempotent without relying on the
-- ADD CONSTRAINT IF NOT EXISTS DDL syntax (not used elsewhere in
-- this repo's migrations).

do $$
declare
  bad_count integer;
begin
  select count(*) into bad_count
    from lesson_slots
   where
     -- Cross-midnight: end > 23:59:59 MSK
     (start_at at time zone 'Europe/Moscow')::time
       + (duration_minutes * interval '1 minute') > time '23:59:59'
     -- Start out of business band: <06:00 or >22:00 MSK
     or extract(hour from (start_at at time zone 'Europe/Moscow')) < 6
     or extract(hour from (start_at at time zone 'Europe/Moscow')) > 22
     or (
       extract(hour from (start_at at time zone 'Europe/Moscow')) = 22
       and extract(minute from (start_at at time zone 'Europe/Moscow')) > 0
     )
     -- Start not on 30-min boundary
     or extract(minute from (start_at at time zone 'Europe/Moscow')) not in (0, 30)
     or extract(second from (start_at at time zone 'Europe/Moscow')) > 0;

  if bad_count > 0 then
    raise exception
      'Cannot apply migration 0031: % existing lesson_slots rows violate calendar invariants. Reconcile rows before applying.',
      bad_count;
  end if;
end $$;

-- 1. Cross-midnight forbid — slots end before MSK midnight.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'lesson_slots_within_msk_day') then
    alter table lesson_slots
      add constraint lesson_slots_within_msk_day
        check (
          (start_at at time zone 'Europe/Moscow')::time
            + (duration_minutes * interval '1 minute')
          <= time '23:59:59'
        );
  end if;
end $$;

-- 2. Start within business band — 06:00 ≤ start ≤ 22:00 MSK.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'lesson_slots_start_in_business_hours') then
    alter table lesson_slots
      add constraint lesson_slots_start_in_business_hours
        check (
          extract(hour from (start_at at time zone 'Europe/Moscow')) >= 6
          and (
            extract(hour from (start_at at time zone 'Europe/Moscow')) < 22
            or (
              extract(hour from (start_at at time zone 'Europe/Moscow')) = 22
              and extract(minute from (start_at at time zone 'Europe/Moscow')) = 0
            )
          )
        );
  end if;
end $$;

-- 3. Start aligned to 30-min grid. Duration NOT constrained — pricing
--    has 50-min product (oferta §4); slot blocks render with pixel-
--    precise absolute positioning.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'lesson_slots_start_30min_aligned') then
    alter table lesson_slots
      add constraint lesson_slots_start_30min_aligned
        check (
          extract(minute from (start_at at time zone 'Europe/Moscow')) in (0, 30)
          and extract(second from (start_at at time zone 'Europe/Moscow')) = 0
        );
  end if;
end $$;
