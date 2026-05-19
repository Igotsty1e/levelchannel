// BCS-DEF-5 (2026-05-19) — pure-ESM mirror of lib/auth/timezones.ts.
//
// The TS file is browser-bundle-safe (no DB imports). The .mjs cron
// scripts cannot import TS or `@/`-aliased paths, so this mirror is
// the runtime surface for the digest cron.
//
// MUST stay in lockstep with:
//   - lib/auth/timezones.ts TIMEZONE_OPTIONS (19 names, source of truth)
//   - migrations/0048_account_profiles_timezone_backfill.sql
//   - migrations/0064_account_profiles_timezone_check.sql
//
// Drift test (tests/scripts/timezone-mjs-mirror.test.ts) pins JSON
// stringification equality of the allowlist with the TS source.
//
// Plan: docs/plans/bcs-def-5-teacher-reminders.md §1.4 + §2.2.0.

export const ALLOWED_TIMEZONES = Object.freeze([
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
  'America/Los_Angeles',
])

const ALLOWED_SET = new Set(ALLOWED_TIMEZONES)

/**
 * Defensive helper for render paths + SQL composition: returns a
 * guaranteed-valid IANA tz, falling back to Europe/Moscow if the
 * stored value is unknown or null. Mirrors safeTimezone() in
 * lib/auth/timezones.ts:38.
 *
 * @param {string | null | undefined} tz
 * @returns {string} A timezone name in the IANA allowlist.
 */
export function safeTimezone(tz) {
  if (typeof tz === 'string' && ALLOWED_SET.has(tz)) return tz
  return 'Europe/Moscow'
}
