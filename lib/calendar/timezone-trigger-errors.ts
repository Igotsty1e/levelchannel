// Narrow-match helpers for PostgreSQL 23514 (check_violation) errors
// raised by mig 0107's two timezone-invariant triggers. The catches in
// app/api/account/profile/route.ts (PATCH) and app/api/teacher/calendar/
// google/callback/route.ts MUST use these — broader matching on `23514`
// alone would misreport unrelated CHECK violations (display_name length,
// mig 0069 IANA list, mig 0095 column CHECKs) as `timezone_required`.
//
// Plan: docs/plans/calendar-onboarding-followup-2026-06-06.md

const PG_CHECK_VIOLATION_CODE = '23514'

type MaybePgError = { code?: unknown; message?: unknown }

function hasCheckViolation(err: MaybePgError, prefix: string): boolean {
  if (err == null || typeof err !== 'object') return false
  const code = (err as MaybePgError).code
  const message = (err as MaybePgError).message
  return (
    code === PG_CHECK_VIOLATION_CODE
    && typeof message === 'string'
    && message.startsWith(prefix)
  )
}

/**
 * True if the error is the trigger raised when a teacher tries to clear
 * their profile timezone while an active|degraded calendar integration
 * exists (or to insert/delete a profile row that would orphan the
 * invariant).
 */
export function isAccountProfilesClearTimezoneError(err: unknown): boolean {
  return hasCheckViolation(err as MaybePgError, 'account_profiles:')
}

/**
 * True if the error is the trigger raised when a calendar integration
 * write targets active|degraded but the teacher's profile.timezone is
 * NULL.
 */
export function isCalendarRequireTimezoneError(err: unknown): boolean {
  return hasCheckViolation(
    err as MaybePgError,
    'teacher_calendar_integrations: timezone must be set',
  )
}
