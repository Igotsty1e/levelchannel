-- BUG-2026-05-13-3 — tariff duration is mandatory.
--
-- Problem (product-owner intake 2026-05-13): tariffs were created
-- without a duration field, which let a 90-minute tariff get bound to
-- a 60-minute slot (and the inverse). Lesson length is part of the
-- product — a 60-min and a 90-min "урок" are different deliverables
-- with different prices.
--
-- Fix: add `duration_minutes integer not null` with the usual 30/45/
-- 60/90 product band, plus a 15-240 hard cap to keep the value sane.
-- Existing rows are backfilled to 60 — that's what 100% of live
-- production tariffs already mean today (lesson-60min is the only
-- tariff actually used). If ops later decides some existing rows
-- represent 90-min sessions, they can flip via the admin UI; the
-- duration field is now editable like price (subject to the same
-- `pricing_tariffs_amount_immutable` rule — see migration 0033 — to
-- guard against duration-after-binding drift; see PR for the parallel
-- trigger added in this migration).

alter table pricing_tariffs
  add column if not exists duration_minutes integer not null default 60;

-- Keep the column non-defaulting once the backfill is in place. New
-- inserts must supply a duration explicitly (admin UI shows a select).
alter table pricing_tariffs
  alter column duration_minutes drop default;

-- Sane band. The product currently sells 30/45/60/90, with room for
-- non-standard durations (e.g. a 50-min half-class) up to 240 min.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'pricing_tariffs_duration_band'
  ) then
    alter table pricing_tariffs
      add constraint pricing_tariffs_duration_band
        check (duration_minutes between 15 and 240);
  end if;
end $$;

-- Duration is also immutable after first slot reference. Same FK-as-
-- snapshot pattern as amount_kopecks (migration 0033). Without this
-- guard, an admin could change a tariff from 60→90 minutes after
-- learners booked slots at it — past slots would silently misalign
-- with their stored tariff_id, breaking package consumption math.
create or replace function pricing_tariffs_duration_immutable()
returns trigger language plpgsql as $$
begin
  if new.duration_minutes is distinct from old.duration_minutes then
    if exists (select 1 from lesson_slots where tariff_id = old.id) then
      raise exception 'pricing_tariffs: duration_minutes immutable after first slot reference (id=%)', old.id
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists pricing_tariffs_duration_guard on pricing_tariffs;
create trigger pricing_tariffs_duration_guard
before update on pricing_tariffs
for each row execute function pricing_tariffs_duration_immutable();

comment on column pricing_tariffs.duration_minutes is
  'BUG-2026-05-13-3: required lesson length for the tariff. Immutable after first slot reference (see pricing_tariffs_duration_guard trigger).';
