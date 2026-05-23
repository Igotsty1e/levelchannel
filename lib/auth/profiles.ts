import { getAuthPool } from '@/lib/auth/pool'
import { computeDisplayNameForStorage } from '@/lib/auth/profile-name'
import {
  ALLOWED_TIMEZONES,
  TIMEZONE_OPTIONS,
  safeTimezone,
} from '@/lib/auth/timezones'

// Re-export so existing callers (server-side imports) keep working
// without churn. The constants themselves live in
// `lib/auth/timezones.ts` — that file has NO DB imports, which is
// what makes it bundle-safe for the cabinet's client island.
export { ALLOWED_TIMEZONES, TIMEZONE_OPTIONS, safeTimezone }

export type AccountProfile = {
  accountId: string
  displayName: string | null
  // TASK-5 (mig 0095) — first_name + last_name. Both NULLABLE for
  // back-compat (legacy rows had display_name only). Optional on the
  // type so existing callers don't have to update construction sites.
  firstName?: string | null
  lastName?: string | null
  timezone: string | null
  locale: string | null
  createdAt: string
  updatedAt: string
}

export type AccountProfileUpdate = {
  // Legacy single-field path. PATCH still accepts displayName for
  // back-compat (admin tools, scripts). When the caller also passes
  // firstName/lastName, those WIN and the storage display_name is
  // recomputed via computeDisplayNameForStorage(). When ONLY
  // displayName is passed, the legacy semantics apply (store as-is).
  displayName?: string | null
  firstName?: string | null
  lastName?: string | null
  timezone?: string | null
  locale?: string | null
}

const ALLOWED_LOCALES = new Set<string>(['ru'])

export type ProfileValidationError =
  | { field: 'displayName'; reason: 'too_long' | 'too_short' }
  | { field: 'firstName'; reason: 'too_long' | 'too_short' }
  | { field: 'lastName'; reason: 'too_long' | 'too_short' }
  | { field: 'timezone'; reason: 'unsupported' }
  | { field: 'locale'; reason: 'unsupported' }

function validateNameField(
  value: string | null | undefined,
  field: 'displayName' | 'firstName' | 'lastName',
  allowNull: boolean,
): ProfileValidationError | null {
  if (value === undefined) return null
  if (value === null) {
    // firstName / lastName accept null (no name yet); displayName
    // legacy path requires non-empty when set (mig 0017 CHECK).
    return allowNull ? null : { field, reason: 'too_short' }
  }
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    // For first/last, empty string means "clear" — caller intent is
    // null, not '' (we map to null in the writer). For legacy
    // displayName, empty is a 400.
    return allowNull ? null : { field, reason: 'too_short' }
  }
  if (trimmed.length > 60) {
    return { field, reason: 'too_long' }
  }
  return null
}

export function validateProfileUpdate(
  update: AccountProfileUpdate,
): ProfileValidationError | null {
  // displayName legacy path: empty string is an error (mig 0017 CHECK
  // rejects ''; null is fine if caller wants to clear).
  if (update.displayName !== undefined && update.displayName !== null) {
    const trimmed = update.displayName.trim()
    if (trimmed.length === 0) {
      return { field: 'displayName', reason: 'too_short' }
    }
    if (trimmed.length > 60) {
      return { field: 'displayName', reason: 'too_long' }
    }
  }
  // first_name / last_name: null is OK (no name yet); empty maps to
  // null in the writer so we treat '' the same as null here. Length
  // cap is 60 (mig 0095 CHECK).
  const firstErr = validateNameField(update.firstName, 'firstName', true)
  if (firstErr) return firstErr
  const lastErr = validateNameField(update.lastName, 'lastName', true)
  if (lastErr) return lastErr

  if (update.timezone !== undefined && update.timezone !== null) {
    if (!ALLOWED_TIMEZONES.has(update.timezone)) {
      return { field: 'timezone', reason: 'unsupported' }
    }
  }
  if (update.locale !== undefined && update.locale !== null) {
    if (!ALLOWED_LOCALES.has(update.locale)) {
      return { field: 'locale', reason: 'unsupported' }
    }
  }
  return null
}

function rowToProfile(row: Record<string, unknown>): AccountProfile {
  return {
    accountId: String(row.account_id),
    displayName: row.display_name === null ? null : String(row.display_name),
    firstName: row.first_name === null || row.first_name === undefined
      ? null
      : String(row.first_name),
    lastName: row.last_name === null || row.last_name === undefined
      ? null
      : String(row.last_name),
    timezone: row.timezone === null ? null : String(row.timezone),
    locale: row.locale === null ? null : String(row.locale),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  }
}

export async function getAccountProfile(
  accountId: string,
): Promise<AccountProfile | null> {
  const pool = getAuthPool()
  const result = await pool.query(
    `select account_id, display_name, first_name, last_name, timezone, locale, created_at, updated_at
     from account_profiles
     where account_id = $1`,
    [accountId],
  )
  return result.rows[0] ? rowToProfile(result.rows[0]) : null
}

// Upsert: a fresh account has no profile row yet. The first PATCH
// from the cabinet creates it; subsequent PATCHes update.
//
// TASK-5 (mig 0095) — firstName/lastName are the canonical write path
// for new code. When the caller passes EITHER firstName or lastName,
// the storage display_name is recomputed (NULL on empty). When only
// displayName is passed (legacy path: scripts, admin tools), it is
// written as-is.
export async function upsertAccountProfile(
  accountId: string,
  update: AccountProfileUpdate,
): Promise<AccountProfile> {
  const validation = validateProfileUpdate(update)
  if (validation) {
    throw new Error(
      `profile validation failed: ${validation.field}/${validation.reason}`,
    )
  }
  const pool = getAuthPool()

  const hasFirstName = 'firstName' in update
  const hasLastName = 'lastName' in update
  const hasDisplayName = 'displayName' in update

  // Normalise first/last: empty string → null (we never store '' for
  // a name field; the CHECK constraints reject it).
  const normaliseNameInput = (v: string | null | undefined): string | null => {
    if (v === null || v === undefined) return null
    const trimmed = v.trim()
    return trimmed.length === 0 ? null : trimmed
  }
  const firstName = hasFirstName ? normaliseNameInput(update.firstName) : undefined
  const lastName = hasLastName ? normaliseNameInput(update.lastName) : undefined

  // Decide storage display_name:
  //   - if first/last name was provided in this PATCH → recompute
  //     from (firstName ?? existing first_name, lastName ?? existing last_name);
  //     here we use the values caller intended this PATCH to land. NULL on empty.
  //   - else if legacy displayName was provided → use it directly
  //     (trimmed; null if clear).
  //   - else → undefined (keep current value via the CASE clause).
  let displayNameToWrite: string | null | undefined
  if (hasFirstName || hasLastName) {
    displayNameToWrite = computeDisplayNameForStorage({
      firstName: firstName ?? null,
      lastName: lastName ?? null,
    })
  } else if (hasDisplayName) {
    displayNameToWrite =
      typeof update.displayName === 'string'
        ? update.displayName.trim().length === 0
          ? null
          : update.displayName.trim()
        : update.displayName ?? null
  } else {
    displayNameToWrite = undefined
  }

  const timezone = 'timezone' in update ? update.timezone ?? null : undefined
  const locale = 'locale' in update ? update.locale ?? null : undefined

  const shouldWriteDisplay = displayNameToWrite !== undefined
  const result = await pool.query(
    `insert into account_profiles (
       account_id, display_name, first_name, last_name, timezone, locale
     ) values ($1, $2, $3, $4, $5, $6)
     on conflict (account_id) do update set
       display_name = case when $7 then excluded.display_name else account_profiles.display_name end,
       first_name   = case when $8 then excluded.first_name   else account_profiles.first_name   end,
       last_name    = case when $9 then excluded.last_name    else account_profiles.last_name    end,
       timezone     = case when $10 then excluded.timezone     else account_profiles.timezone     end,
       locale       = case when $11 then excluded.locale       else account_profiles.locale       end,
       updated_at = now()
     returning account_id, display_name, first_name, last_name, timezone, locale, created_at, updated_at`,
    [
      accountId,
      shouldWriteDisplay ? displayNameToWrite ?? null : null,
      hasFirstName ? firstName ?? null : null,
      hasLastName ? lastName ?? null : null,
      timezone ?? null,
      locale ?? null,
      shouldWriteDisplay,
      hasFirstName,
      hasLastName,
      'timezone' in update,
      'locale' in update,
    ],
  )
  return rowToProfile(result.rows[0])
}
