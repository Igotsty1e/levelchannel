import { hashToken, mintToken } from '@/lib/auth/tokens'
import { getAuthPool } from '@/lib/auth/pool'

// One-shot tokens for verify-email and password-reset. Same shape, two
// different tables, two different TTLs. We hardcode the table name via a
// whitelist so the scope cannot smuggle SQL through the call site.

export type SingleUseTokenScope = 'email_verifications' | 'password_resets'

const TABLES: Record<SingleUseTokenScope, string> = {
  email_verifications: 'email_verifications',
  password_resets: 'password_resets',
}

// Defensive: TS already gates the scope, but a JS caller or any-cast bypass
// would let scope be undefined and produce SQL against `undefined` — a 500
// instead of a clear invariant error. Throw early with a typed message.
function tableFor(scope: SingleUseTokenScope): string {
  const table = TABLES[scope]
  if (!table) {
    throw new Error(`Unknown single-use token scope: ${String(scope)}`)
  }
  return table
}

export async function createSingleUseToken(
  scope: SingleUseTokenScope,
  accountId: string,
  ttlMs: number,
): Promise<{ token: string }> {
  const table = tableFor(scope)
  const pool = getAuthPool()
  const { plain, hash } = mintToken()
  const expiresAt = new Date(Date.now() + ttlMs).toISOString()
  await pool.query(
    `insert into ${table} (account_id, token_hash, expires_at) values ($1, $2, $3)`,
    [accountId, hash, expiresAt],
  )
  return { token: plain }
}

export async function consumeSingleUseToken(
  scope: SingleUseTokenScope,
  token: string,
): Promise<{ accountId: string } | null> {
  if (!token) return null
  const table = tableFor(scope)
  const hash = hashToken(token)
  const pool = getAuthPool()
  const client = await pool.connect()

  try {
    await client.query('begin')

    const result = await client.query(
      `select id, account_id, expires_at, consumed_at from ${table}
       where token_hash = $1
       for update`,
      [hash],
    )

    const row = result.rows[0]

    if (!row || row.consumed_at) {
      await client.query('rollback')
      return null
    }

    if (new Date(String(row.expires_at)).getTime() <= Date.now()) {
      await client.query('rollback')
      return null
    }

    await client.query(
      `update ${table} set consumed_at = now() where id = $1`,
      [row.id],
    )

    await client.query('commit')
    return { accountId: String(row.account_id) }
  } catch (error) {
    await client.query('rollback').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}
