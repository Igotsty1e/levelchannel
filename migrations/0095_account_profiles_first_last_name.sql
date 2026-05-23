-- TASK-5 (2026-05-23) — first_name + last_name on account_profiles.
-- Plan: docs/plans/teacher-cabinet-polish.md §2.1.
--
-- Both columns are NULLABLE so the migration is non-blocking; the
-- UI is the source of truth for "what shape does a name take now".
-- display_name is KEPT in this migration for one release cycle;
-- a post-MVP epic computes it virtually or drops it.
--
-- Backfill rule (deterministic, idempotent):
--   - split display_name on FIRST whitespace
--   - left of split -> first_name; right of split -> last_name (may be NULL)
--   - if display_name has no whitespace -> first_name = display_name, last_name NULL
--   - if display_name is NULL or empty -> both NULL
--   - multi-space names ("Анна-Мария Иванова") split on the FIRST space;
--     "Анна-Мария" lands in first_name, "Иванова" in last_name. Acceptable —
--     the user can edit the form later.
--
-- Re-running the migration is safe: ADD COLUMN IF NOT EXISTS + the
-- UPDATE has a "WHERE first_name IS NULL AND last_name IS NULL" guard
-- so it never overwrites manually-set values.

alter table account_profiles
  add column if not exists first_name text null,
  add column if not exists last_name text null;

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'account_profiles_first_name_len'
  ) then
    alter table account_profiles
      add constraint account_profiles_first_name_len
        check (first_name is null or (char_length(first_name) between 1 and 60));
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'account_profiles_last_name_len'
  ) then
    alter table account_profiles
      add constraint account_profiles_last_name_len
        check (last_name is null or (char_length(last_name) between 1 and 60));
  end if;
end $$;

update account_profiles
   set first_name = case
         when display_name is null then null
         when trim(display_name) = '' then null
         when position(' ' in trim(display_name)) = 0 then trim(display_name)
         else substring(trim(display_name) from 1 for position(' ' in trim(display_name)) - 1)
       end,
       last_name = case
         when display_name is null then null
         when trim(display_name) = '' then null
         when position(' ' in trim(display_name)) = 0 then null
         else trim(substring(trim(display_name) from position(' ' in trim(display_name)) + 1))
       end
 where first_name is null
   and last_name is null;
