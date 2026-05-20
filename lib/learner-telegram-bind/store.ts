// BCS-DEF-4-TG (2026-05-20) — bind-code workflow storage helpers.
//
// Plan: docs/plans/bcs-def-4-tg-telegram-reminders.md §2.3 + §2.5.

import { randomInt } from 'crypto'

import { getAuthPool } from '@/lib/auth/pool'

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no 0/O/1/I/l
const CODE_LEN = 8
const TTL_MS = 10 * 60 * 1000 // 10 minutes

export type BindCodeRow = {
  id: string
  accountId: string
  code: string
  createdAt: string
  expiresAt: string
  consumedAt: string | null
  consumedChatId: string | null
}

export function generateBindCode(): string {
  let out = ''
  for (let i = 0; i < CODE_LEN; i += 1) {
    out += CODE_ALPHABET[randomInt(0, CODE_ALPHABET.length)]
  }
  return out
}

// Issue a fresh code for the account. Caller MUST hold the account-
// scoped advisory lock (see actions.ts) — issuing implicitly invalidates
// any prior active code by deleting it within the same TX.
export async function issueBindCode(
  accountId: string,
): Promise<BindCodeRow> {
  const pool = getAuthPool()
  const code = generateBindCode()
  const now = new Date()
  const expiresAt = new Date(now.getTime() + TTL_MS)
  // Delete any prior active (unconsumed) codes for this account so the
  // "one active code at a time" invariant holds. Partial index
  // ltbc_account_active_idx makes this fast.
  await pool.query(
    `delete from learner_telegram_bind_codes
       where account_id = $1::uuid and consumed_at is null`,
    [accountId],
  )
  const r = await pool.query<{
    id: string
    account_id: string
    code: string
    created_at: string
    expires_at: string
    consumed_at: string | null
    consumed_chat_id: string | null
  }>(
    `insert into learner_telegram_bind_codes
       (account_id, code, created_at, expires_at)
       values ($1::uuid, $2, $3::timestamptz, $4::timestamptz)
       returning id, account_id, code, created_at, expires_at, consumed_at, consumed_chat_id`,
    [accountId, code, now.toISOString(), expiresAt.toISOString()],
  )
  const row = r.rows[0]
  return {
    id: String(row.id),
    accountId: String(row.account_id),
    code: String(row.code),
    createdAt: String(row.created_at),
    expiresAt: String(row.expires_at),
    consumedAt: row.consumed_at ? String(row.consumed_at) : null,
    consumedChatId: row.consumed_chat_id ? String(row.consumed_chat_id) : null,
  }
}

// Look up an active (unconsumed, non-expired) bind code by its 8-char
// string. Used by the Telegram webhook on /start <code>. Returns null
// if missing, expired, or already consumed.
export async function findActiveBindCode(
  code: string,
): Promise<BindCodeRow | null> {
  if (!/^[A-Z0-9]{8}$/.test(code)) return null
  const pool = getAuthPool()
  const r = await pool.query(
    `select id, account_id, code, created_at, expires_at, consumed_at, consumed_chat_id
       from learner_telegram_bind_codes
      where code = $1
        and consumed_at is null
        and expires_at > now()
      limit 1`,
    [code],
  )
  const row = r.rows[0]
  if (!row) return null
  return {
    id: String(row.id),
    accountId: String(row.account_id),
    code: String(row.code),
    createdAt: String(row.created_at),
    expiresAt: String(row.expires_at),
    consumedAt: null,
    consumedChatId: null,
  }
}
