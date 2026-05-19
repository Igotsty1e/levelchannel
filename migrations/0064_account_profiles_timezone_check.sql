-- BCS-DEF-5 (2026-05-19) — DB-side IANA timezone CHECK constraint on
-- account_profiles.timezone. Round-3 BLOCKER 3 closure
-- (docs/plans/bcs-def-5-teacher-reminders.md §0e).
--
-- Why: the digest cron's candidate-set SQL evaluates
--   `now() AT TIME ZONE coalesce(p.timezone, 'Europe/Moscow')`
-- inside a single round-trip per tick. A single bad timezone string in
-- account_profiles.timezone would raise an exception and crash the
-- whole tick. The application-level safeTimezone() defensive helper
-- only protects render paths, not the SQL hot path.
--
-- Belt-and-suspenders even though migration 0048 already nulled legacy
-- non-IANA rows: re-normalize any rows that slipped through (e.g. via
-- a non-app DB write path), then add a NOT VALID CHECK so future
-- inserts/updates are gated.
--
-- Approach (3 statements):
--   1. UPDATE non-IANA rows → NULL (re-runs migration 0048's normalize
--      idempotently — no-op if already clean).
--   2. ALTER ADD CONSTRAINT ... NOT VALID (cheap; doesn't re-scan).
--   3. ALTER VALIDATE CONSTRAINT (re-scans the table to confirm; safe
--      because step 1 already cleaned the data).
--
-- Source list MUST stay in lockstep with:
--   - lib/auth/timezones.ts TIMEZONE_OPTIONS (TS surface, 19 names)
--   - scripts/lib/timezone.mjs ALLOWED_TIMEZONES (.mjs mirror)
--   - migrations/0048_account_profiles_timezone_backfill.sql

-- 1. Re-normalize any non-IANA values to NULL (idempotent vs. 0048).
update account_profiles
   set timezone = null,
       updated_at = now()
 where timezone is not null
   and timezone not in (
     'Europe/Moscow',
     'Europe/Kaliningrad',
     'Europe/Samara',
     'Asia/Yekaterinburg',
     'Asia/Omsk',
     'Asia/Krasnoyarsk',
     'Asia/Irkutsk',
     'Asia/Yakutsk',
     'Asia/Vladivostok',
     'Asia/Magadan',
     'Asia/Kamchatka',
     'Asia/Tbilisi',
     'Asia/Yerevan',
     'Asia/Almaty',
     'Asia/Dubai',
     'Europe/London',
     'Europe/Berlin',
     'America/New_York',
     'America/Los_Angeles'
   );

-- 2. NOT VALID — adds the constraint without a full table scan.
alter table account_profiles
  add constraint account_profiles_timezone_iana_check
    check (
      timezone is null or timezone in (
        'Europe/Moscow',
        'Europe/Kaliningrad',
        'Europe/Samara',
        'Asia/Yekaterinburg',
        'Asia/Omsk',
        'Asia/Krasnoyarsk',
        'Asia/Irkutsk',
        'Asia/Yakutsk',
        'Asia/Vladivostok',
        'Asia/Magadan',
        'Asia/Kamchatka',
        'Asia/Tbilisi',
        'Asia/Yerevan',
        'Asia/Almaty',
        'Asia/Dubai',
        'Europe/London',
        'Europe/Berlin',
        'America/New_York',
        'America/Los_Angeles'
      )
    ) not valid;

-- 3. VALIDATE — re-scans the table now that step 1 cleaned the data.
-- Safe to fail at this point would indicate a row inserted between
-- statement 1 and 2 with a non-IANA value, which is itself a signal
-- worth surfacing.
alter table account_profiles
  validate constraint account_profiles_timezone_iana_check;

comment on constraint account_profiles_timezone_iana_check
  on account_profiles is
  'BCS-DEF-5 (2026-05-19): timezone must be NULL or an IANA name from '
  'the 19-entry allowlist matching lib/auth/timezones.ts. Belts the '
  'digest cron SQL hot path (AT TIME ZONE coalesce(p.timezone, ...)) '
  'against legacy bad rows. Plan §0e BLOCKER 3 closure.';
