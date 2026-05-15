-- 2026-05-15 — backfill non-IANA `account_profiles.timezone` values.
--
-- Bug context: learner booking flow (`/cabinet/book/...`) renders the
-- learner's `profile.timezone` straight into the API request to
-- /api/slots/booking-days. Legacy rows with a non-IANA value (e.g.
-- the plain string 'Moscow') leaked into `tz=Moscow` and the
-- validator returned "tz must be a valid IANA timezone" → the day
-- grid never rendered.
--
-- Application-layer fix (lib/auth/profiles.ts + lib/auth/timezones.ts)
-- already prevents new bad inserts via an allowlist. This migration
-- clamps the legacy rows so the safeTimezone() fallback in the
-- application is a backstop, not the primary defence.
--
-- Sets timezone = NULL when the stored value is outside the
-- application-level allowlist (one of the 19 IANA names in
-- lib/auth/timezones.ts). NULL is the documented "tz not yet chosen"
-- state — the cabinet renderer falls back to Europe/Moscow + the
-- profile editor lets the learner pick the right one.

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
