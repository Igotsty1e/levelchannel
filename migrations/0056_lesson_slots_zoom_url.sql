-- BCS-DEF-3 (2026-05-18) — optional zoom URL on a lesson slot.
-- Nullable text; admin + teacher can set/clear it on a booked slot
-- (independent of the otherwise-locked schedule/tariff fields).
-- Length capped at 512 chars; must start with https:// when present
-- (no http:// or javascript: schemes — a learner clicks this link
-- from the cabinet).

alter table lesson_slots
  add column if not exists zoom_url text null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'lesson_slots_zoom_url_shape'
  ) then
    alter table lesson_slots
      add constraint lesson_slots_zoom_url_shape
      check (
        zoom_url is null
        or (
          length(zoom_url) <= 512
          and zoom_url ~ '^https://'
        )
      );
  end if;
end$$;
