import { randomUUID } from 'node:crypto'

import { getAuthPool } from '@/lib/auth/pool'

export type Account = {
  id: string
  email: string
  passwordHash: string
  emailVerifiedAt: string | null
  disabledAt: string | null
  createdAt: string
  updatedAt: string
}

export type AccountRole = 'admin' | 'teacher' | 'student'

function rowToAccount(row: Record<string, unknown>): Account {
  return {
    id: String(row.id),
    email: String(row.email),
    passwordHash: String(row.password_hash),
    emailVerifiedAt: row.email_verified_at
      ? new Date(String(row.email_verified_at)).toISOString()
      : null,
    disabledAt: row.disabled_at
      ? new Date(String(row.disabled_at)).toISOString()
      : null,
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  }
}

export async function getAccountByEmail(email: string): Promise<Account | null> {
  const pool = getAuthPool()
  const result = await pool.query(
    `select id, email, password_hash, email_verified_at, disabled_at, created_at, updated_at
     from accounts where email = $1 limit 1`,
    [email.toLowerCase()],
  )
  return result.rows[0] ? rowToAccount(result.rows[0]) : null
}

export async function getAccountById(id: string): Promise<Account | null> {
  const pool = getAuthPool()
  const result = await pool.query(
    `select id, email, password_hash, email_verified_at, disabled_at, created_at, updated_at
     from accounts where id = $1 limit 1`,
    [id],
  )
  return result.rows[0] ? rowToAccount(result.rows[0]) : null
}

export async function createAccount(params: {
  email: string
  passwordHash: string
}): Promise<Account> {
  const pool = getAuthPool()
  const id = randomUUID()
  const result = await pool.query(
    `insert into accounts (id, email, password_hash) values ($1, $2, $3)
     returning id, email, password_hash, email_verified_at, disabled_at, created_at, updated_at`,
    [id, params.email.toLowerCase(), params.passwordHash],
  )
  return rowToAccount(result.rows[0])
}

export async function markAccountVerified(accountId: string): Promise<void> {
  const pool = getAuthPool()
  await pool.query(
    `update accounts set email_verified_at = coalesce(email_verified_at, now()), updated_at = now()
     where id = $1`,
    [accountId],
  )
}

export async function setAccountPassword(
  accountId: string,
  passwordHash: string,
): Promise<void> {
  const pool = getAuthPool()
  await pool.query(
    `update accounts set password_hash = $2, updated_at = now() where id = $1`,
    [accountId, passwordHash],
  )
}

export async function listAccountRoles(accountId: string): Promise<AccountRole[]> {
  const pool = getAuthPool()
  const result = await pool.query(
    `select role from account_roles where account_id = $1 order by role asc`,
    [accountId],
  )
  return result.rows.map((r) => String(r.role) as AccountRole)
}

export async function grantAccountRole(
  accountId: string,
  role: AccountRole,
  grantedByAccountId: string | null,
): Promise<void> {
  const pool = getAuthPool()
  await pool.query(
    `insert into account_roles (account_id, role, granted_by_account_id)
     values ($1, $2, $3)
     on conflict (account_id, role) do nothing`,
    [accountId, role, grantedByAccountId],
  )
}

export async function revokeAccountRole(
  accountId: string,
  role: AccountRole,
): Promise<void> {
  const pool = getAuthPool()
  await pool.query(
    `delete from account_roles where account_id = $1 and role = $2`,
    [accountId, role],
  )
}
