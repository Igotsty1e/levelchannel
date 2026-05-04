-- Phase 3 — learner profile (1:1 with accounts).
--
-- Kept separate from the accounts table because:
--   - accounts is the auth surface and changes infrequently; profile
--     fields evolve as the product grows (Phase 4 will add timezone
--     defaults, Phase 6 may add billing prefs)
--   - splitting also makes it easy to clear profile data on account
--     purge (see migration 0019) without touching the auth row's
--     financial-record-bearing fields
--
-- All fields are nullable: registration is intentionally cheap (email
-- + password + consent only) and the profile is filled in from the
-- cabinet later. `display_name` falls back to email at the UI layer.
--
-- locale is `text` instead of an enum so we don't need a migration to
-- add `en` later. The application validates the value against an
-- allowlist (lib/auth/profiles.ts).
--
-- timezone is an IANA name (`Europe/Moscow`, `Asia/Yekaterinburg`).
-- Postgres has the AT TIME ZONE machinery to honour it once Phase 4
-- starts stamping lesson slots; storing the raw IANA string is the
-- forward-compatible shape.

create table if not exists account_profiles (
  account_id uuid primary key references accounts(id) on delete cascade,
  display_name text null,
  timezone text null,
  locale text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint account_profiles_display_name_len
    check (display_name is null or (char_length(display_name) between 1 and 60)),
  constraint account_profiles_locale_allowlist
    check (locale is null or locale in ('ru'))
);
