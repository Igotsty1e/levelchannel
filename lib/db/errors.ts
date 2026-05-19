// Shared Postgres error-code helpers.
//
// AUDIT-CODE-3 (2026-05-17): extracted from
// `lib/admin/probe-status.ts` + `app/api/admin/settings/alerts/[probe]/test-send/route.ts`
// where the predicate was duplicated. Duplication risk: if one site
// later needs an extra error code (e.g. partial-migration column
// missing = `42703`), the other site silently diverges.
//
// Source of truth: PostgreSQL SQLSTATE codes
// https://www.postgresql.org/docs/current/errcodes-appendix.html.
// Sibling code uses the same shape (`error.code === '23505'` for
// unique violation in lib/payments / lib/billing).

/** SQLSTATE for "relation does not exist" — missing table or view. */
export const ERR_UNDEFINED_TABLE = '42P01'

/** SQLSTATE for "column does not exist" — missing column on an existing table. */
export const ERR_UNDEFINED_COLUMN = '42703'

/** SQLSTATE for "unique violation" — duplicate key on UNIQUE / PRIMARY KEY. */
export const ERR_UNIQUE_VIOLATION = '23505'

/** SQLSTATE for "foreign key violation" — INSERT/UPDATE referencing a missing row. */
export const ERR_FOREIGN_KEY_VIOLATION = '23503'

/** SQLSTATE for "check violation" — value violates a CHECK constraint. */
export const ERR_CHECK_VIOLATION = '23514'

function hasPgErrorCode(err: unknown, code: string): boolean {
  return (
    typeof err === 'object'
    && err !== null
    && 'code' in err
    && (err as { code?: unknown }).code === code
  )
}

/**
 * True if the Postgres error indicates the referenced table/view does
 * not exist (SQLSTATE 42P01). Use this when a code path may run
 * before its supporting migration has been applied — the graceful
 * degradation pattern from ALERTS-OBS (admin page returns
 * `{ migrationPending: true }` instead of 500).
 */
export function isUndefinedTableError(err: unknown): boolean {
  return hasPgErrorCode(err, ERR_UNDEFINED_TABLE)
}

/**
 * True if the Postgres error indicates the referenced column does not
 * exist (SQLSTATE 42703). Sibling of `isUndefinedTableError` — surfaces
 * the same migration-pending degradation when an ADDITIVE column
 * migration has not yet applied but NEW code is already running.
 *
 * Introduced by BCS-DEF-1-TG (2026-05-19) so the
 * `/admin/settings/alerts` page can render `{ migrationPending: true }`
 * during the brief deploy-recovery window where migration 0061
 * (`probe_runs.recipient_kind`) was rolled back after NEW code
 * swapped in. See `lib/admin/probe-status.ts` and the plan §2.7.2.
 */
export function isUndefinedColumnError(err: unknown): boolean {
  return hasPgErrorCode(err, ERR_UNDEFINED_COLUMN)
}

/** True if the Postgres error is a unique-constraint violation. */
export function isUniqueViolationError(err: unknown): boolean {
  return hasPgErrorCode(err, ERR_UNIQUE_VIOLATION)
}

/** True if the Postgres error is a foreign-key violation. */
export function isForeignKeyViolationError(err: unknown): boolean {
  return hasPgErrorCode(err, ERR_FOREIGN_KEY_VIOLATION)
}

/** True if the Postgres error is a CHECK constraint violation. */
export function isCheckViolationError(err: unknown): boolean {
  return hasPgErrorCode(err, ERR_CHECK_VIOLATION)
}
