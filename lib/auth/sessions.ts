import type { Account } from '@/lib/auth/accounts'
import { hashToken, mintToken } from '@/lib/auth/tokens'
import { getAuthPool } from '@/lib/auth/pool'

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000

export const SESSION_COOKIE_NAME = 'lc_session'
export const SESSION_COOKIE_TTL_SECONDS = Math.floor(SESSION_TTL_MS / 1000)

export type Session = {
  id: string
  accountId: string
  expiresAt: string
  createdAt: string
}

export async function createSession(params: {
  accountId: string
  ip?: string | null
  userAgent?: string | null
}): Promise<{ session: Session; cookieValue: string }> {
  const pool = getAuthPool()
  const { plain, hash } = mintToken()
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString()

  const result = await pool.query(
    `insert into account_sessions (account_id, token_hash, expires_at, ip, user_agent)
     values ($1, $2, $3, $4, $5)
     returning id, account_id, expires_at, created_at`,
    [params.accountId, hash, expiresAt, params.ip || null, params.userAgent || null],
  )
  const row = result.rows[0]
  return {
    cookieValue: plain,
    session: {
      id: String(row.id),
      accountId: String(row.account_id),
      expiresAt: new Date(String(row.expires_at)).toISOString(),
      createdAt: new Date(String(row.created_at)).toISOString(),
    },
  }
}

export async function lookupSession(
  cookieValue: string,
): Promise<{ session: Session; account: Account } | null> {
  if (!cookieValue) return null
  const hash = hashToken(cookieValue)
  const pool = getAuthPool()
  const result = await pool.query(
    `select s.id as session_id, s.account_id as session_account_id, s.expires_at as session_expires_at,
            s.revoked_at as session_revoked_at, s.created_at as session_created_at,
            a.id as account_id, a.email, a.password_hash, a.email_verified_at, a.disabled_at,
            a.created_at as account_created_at, a.updated_at as account_updated_at
     from account_sessions s
     join accounts a on a.id = s.account_id
     where s.token_hash = $1
     limit 1`,
    [hash],
  )
  const row = result.rows[0]
  if (!row) return null
  if (row.session_revoked_at) return null
  if (new Date(String(row.session_expires_at)).getTime() <= Date.now()) return null
  if (row.disabled_at) return null

  return {
    session: {
      id: String(row.session_id),
      accountId: String(row.session_account_id),
      expiresAt: new Date(String(row.session_expires_at)).toISOString(),
      createdAt: new Date(String(row.session_created_at)).toISOString(),
    },
    account: {
      id: String(row.account_id),
      email: String(row.email),
      passwordHash: String(row.password_hash),
      emailVerifiedAt: row.email_verified_at
        ? new Date(String(row.email_verified_at)).toISOString()
        : null,
      disabledAt: row.disabled_at
        ? new Date(String(row.disabled_at)).toISOString()
        : null,
      createdAt: new Date(String(row.account_created_at)).toISOString(),
      updatedAt: new Date(String(row.account_updated_at)).toISOString(),
    },
  }
}

export async function revokeSession(sessionId: string): Promise<void> {
  const pool = getAuthPool()
  await pool.query(
    `update account_sessions set revoked_at = coalesce(revoked_at, now()) where id = $1`,
    [sessionId],
  )
}

export async function revokeAllSessionsForAccount(accountId: string): Promise<void> {
  const pool = getAuthPool()
  await pool.query(
    `update account_sessions set revoked_at = coalesce(revoked_at, now())
     where account_id = $1 and revoked_at is null`,
    [accountId],
  )
}

export function buildSessionCookie(value: string, isProduction: boolean): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=${value}`,
    `Path=/`,
    `Max-Age=${SESSION_COOKIE_TTL_SECONDS}`,
    `HttpOnly`,
    `SameSite=Lax`,
  ]
  if (isProduction) parts.push('Secure')
  return parts.join('; ')
}

export function buildSessionClearCookie(isProduction: boolean): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    `Path=/`,
    `Max-Age=0`,
    `HttpOnly`,
    `SameSite=Lax`,
  ]
  if (isProduction) parts.push('Secure')
  return parts.join('; ')
}

// Pull the lc_session cookie value from a Request's `Cookie` header without
// pulling next/headers — keeps these helpers framework-agnostic.
export function readSessionCookieFromRequest(request: Request): string | null {
  const header = request.headers.get('cookie')
  if (!header) return null
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    const name = part.slice(0, eq).trim()
    if (name !== SESSION_COOKIE_NAME) continue
    return part.slice(eq + 1).trim() || null
  }
  return null
}

// Convenience: read cookie from request, look up session, return resolved
// account + session pair, or null if absent / expired / revoked / disabled.
export async function getCurrentSession(
  request: Request,
): Promise<{ session: Session; account: Account } | null> {
  const cookieValue = readSessionCookieFromRequest(request)
  if (!cookieValue) return null
  return lookupSession(cookieValue)
}
