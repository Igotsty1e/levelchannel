import { getAuthPool } from '@/lib/auth/pool'

export type AccountProfile = {
  accountId: string
  displayName: string | null
  timezone: string | null
  locale: string | null
  createdAt: string
  updatedAt: string
}

export type AccountProfileUpdate = {
  displayName?: string | null
  timezone?: string | null
  locale?: string | null
}

const ALLOWED_LOCALES = new Set<string>(['ru'])

// IANA timezone names: simple regex gate. We don't ship the full IANA
// db; if Postgres `AT TIME ZONE` rejects an unknown name later (Phase
// 4 scheduling) the failure surfaces there. For now this only blocks
// trivially malformed input.
const TIMEZONE_PATTERN = /^[A-Za-z][A-Za-z0-9_+/-]{0,63}$/

export type ProfileValidationError =
  | { field: 'displayName'; reason: 'too_long' | 'too_short' }
  | { field: 'timezone'; reason: 'invalid_format' }
  | { field: 'locale'; reason: 'unsupported' }

export function validateProfileUpdate(
  update: AccountProfileUpdate,
): ProfileValidationError | null {
  if (update.displayName !== undefined && update.displayName !== null) {
    const trimmed = update.displayName.trim()
    if (trimmed.length === 0) {
      return { field: 'displayName', reason: 'too_short' }
    }
    if (trimmed.length > 60) {
      return { field: 'displayName', reason: 'too_long' }
    }
  }
  if (update.timezone !== undefined && update.timezone !== null) {
    if (!TIMEZONE_PATTERN.test(update.timezone)) {
      return { field: 'timezone', reason: 'invalid_format' }
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
    `select account_id, display_name, timezone, locale, created_at, updated_at
     from account_profiles
     where account_id = $1`,
    [accountId],
  )
  return result.rows[0] ? rowToProfile(result.rows[0]) : null
}

// Upsert: a fresh account has no profile row yet. The first PATCH
// from the cabinet creates it; subsequent PATCHes update.
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
  // COALESCE pattern keeps unspecified fields untouched on update.
  // Pass null explicitly to clear a field; pass undefined (mapped to
  // SQL NULL via the parameter) only when you actually want a clear.
  // Callers must distinguish: omit a key to keep current value, set
  // it to null to clear. That distinction is enforced one layer up
  // (the route handler) where the JSON body is parsed.
  const displayName =
    'displayName' in update ? update.displayName ?? null : undefined
  const timezone = 'timezone' in update ? update.timezone ?? null : undefined
  const locale = 'locale' in update ? update.locale ?? null : undefined

  const trimmedDisplayName =
    typeof displayName === 'string' ? displayName.trim() : displayName

  const result = await pool.query(
    `insert into account_profiles (
       account_id, display_name, timezone, locale
     ) values ($1, $2, $3, $4)
     on conflict (account_id) do update set
       display_name = case when $5 then excluded.display_name else account_profiles.display_name end,
       timezone     = case when $6 then excluded.timezone     else account_profiles.timezone     end,
       locale       = case when $7 then excluded.locale       else account_profiles.locale       end,
       updated_at = now()
     returning account_id, display_name, timezone, locale, created_at, updated_at`,
    [
      accountId,
      trimmedDisplayName ?? null,
      timezone ?? null,
      locale ?? null,
      'displayName' in update,
      'timezone' in update,
      'locale' in update,
    ],
  )
  return rowToProfile(result.rows[0])
}

// Used by the deletion-purge job (scripts/db-retention-cleanup.mjs)
// to clear PD on the profile row at the same time as anonymizing the
// account row. Idempotent: if no row exists we're done.
export async function clearAccountProfile(accountId: string): Promise<void> {
  const pool = getAuthPool()
  await pool.query(
    `update account_profiles
        set display_name = null,
            timezone = null,
            locale = null,
            updated_at = now()
      where account_id = $1`,
    [accountId],
  )
}
