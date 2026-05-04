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

// Curated IANA timezone whitelist for the profile dropdown. Russian
// regions are listed first (operator-relevant), then a small set of
// nearby useful zones. The list is intentionally short — the cabinet
// is for Russian learners; an exhaustive picker is overkill and lets
// users save a value that crashes Date.toLocaleString later (e.g.
// raw "Moscow" is NOT a valid IANA name and throws in the browser /
// Node Intl API).
//
// If a learner needs a tz that's not here, they can ask the operator
// to add it; broadening the list without adding the corresponding
// dropdown entries leaves the UI inconsistent.
export const TIMEZONE_OPTIONS: Array<{ id: string; label: string }> = [
  { id: 'Europe/Moscow', label: 'Москва (UTC+3)' },
  { id: 'Europe/Kaliningrad', label: 'Калининград (UTC+2)' },
  { id: 'Europe/Samara', label: 'Самара (UTC+4)' },
  { id: 'Asia/Yekaterinburg', label: 'Екатеринбург (UTC+5)' },
  { id: 'Asia/Omsk', label: 'Омск (UTC+6)' },
  { id: 'Asia/Krasnoyarsk', label: 'Красноярск (UTC+7)' },
  { id: 'Asia/Irkutsk', label: 'Иркутск (UTC+8)' },
  { id: 'Asia/Yakutsk', label: 'Якутск (UTC+9)' },
  { id: 'Asia/Vladivostok', label: 'Владивосток (UTC+10)' },
  { id: 'Asia/Magadan', label: 'Магадан (UTC+11)' },
  { id: 'Asia/Kamchatka', label: 'Петропавловск-Камчатский (UTC+12)' },
  // Common nearby zones for учащихся за рубежом:
  { id: 'Asia/Tbilisi', label: 'Тбилиси (UTC+4)' },
  { id: 'Asia/Yerevan', label: 'Ереван (UTC+4)' },
  { id: 'Asia/Almaty', label: 'Алматы (UTC+6)' },
  { id: 'Asia/Dubai', label: 'Дубай (UTC+4)' },
  { id: 'Europe/London', label: 'Лондон (UTC+0/+1)' },
  { id: 'Europe/Berlin', label: 'Берлин (UTC+1/+2)' },
  { id: 'America/New_York', label: 'Нью-Йорк (UTC-5/-4)' },
  { id: 'America/Los_Angeles', label: 'Лос-Анджелес (UTC-8/-7)' },
]

const ALLOWED_TIMEZONES = new Set<string>(TIMEZONE_OPTIONS.map((t) => t.id))

// Defensive helper for render paths: returns a guaranteed-valid IANA
// tz, falling back to Europe/Moscow if the stored value is unknown.
// This is the last line of defence after the validator + DB constraint;
// it exists so a single bad row from a pre-whitelist era can't 500
// the entire cabinet page.
export function safeTimezone(tz: string | null | undefined): string {
  if (tz && ALLOWED_TIMEZONES.has(tz)) return tz
  return 'Europe/Moscow'
}

export type ProfileValidationError =
  | { field: 'displayName'; reason: 'too_long' | 'too_short' }
  | { field: 'timezone'; reason: 'unsupported' }
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
