-- Drop the MVP-only Moscow-only triggers from mig 0043.
--
-- Owner decision 2026-06-05 (calendar-onboarding-cleanup wave, Option A):
-- relax the MVP gate so any teacher whose profile.timezone is in the
-- existing 19-entry IANA allowlist (mig 0069) can connect Google
-- Calendar, NOT only Europe/Moscow. The 19-entry allowlist itself
-- (lib/auth/timezones.ts + scripts/lib/timezone.mjs + mig 0069 CHECK)
-- is INTENTIONALLY NOT widened in this wave — the calendar runtime
-- (lib/calendar/google/pull.ts all-day +03:00 pin, app/teacher/calendar
-- week anchor, lib/scheduling/slots/validation business band,
-- lib/calendar/dates.ts) is still MSK-hardcoded. Multi-tenant timezone
-- refactor tracked as a separate epic.
--
-- This migration is the MINIMAL change: drop 2 triggers + 2 functions.
-- App-layer guards in app/api/teacher/calendar/google/{start,callback}
-- + app/api/account/profile + app/teacher/settings/calendar enforce the
-- timezone-required invariant.
--
-- DB-level replacement triggers (require-timezone on integration
-- activate; refuse-clear on profile while integration active) are
-- DEFERRED to a follow-up PR — adding them in this wave would create a
-- rolling-deploy race window where OLD app binary (callback for a
-- null-timezone teacher mid-OAuth) hits the new trigger and surfaces
-- 500 instead of the intended redirect. The follow-up PR runs AFTER
-- this wave's app code is fully deployed.
--
-- Plan: docs/plans/calendar-onboarding-cleanup-2026-06-05.md

drop trigger if exists teacher_calendar_integrations_msk_only_guard
  on teacher_calendar_integrations;
drop function if exists teacher_calendar_integrations_msk_only_check();

drop trigger if exists account_profiles_timezone_msk_guard_trg on account_profiles;
drop function if exists account_profiles_timezone_msk_guard();
