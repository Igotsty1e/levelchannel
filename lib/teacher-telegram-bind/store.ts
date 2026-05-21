// BCS-DEF-5-TG (2026-05-21) — bind-code workflow storage helpers.
//
// Plan: docs/plans/bcs-def-5-tg-teacher-telegram-reminders.md §2.2.1.
//
// Mirror of lib/learner-telegram-bind/store.ts (BCS-DEF-4-TG); the
// only difference is the table name (teacher_telegram_bind_codes) +
// the lock-key prefix used at the call-site (`ttbc:` vs `ltbc:`).

import { randomInt } from 'crypto'

import { getAuthPool } from '@/lib/auth/pool'

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no 0/O/1/I/l
const CODE_LEN = 8
const TTL_MS = 10 * 60 * 1000 // 10 minutes

export type TeacherBindCodeRow = {
  id: string
  accountId: string
  code: string
  createdAt: string
  expiresAt: string
  consumedAt: string | null
  consumedChatId: string | null
}

export function generateTeacherBindCode(): string {
  let out = ''
  for (let i = 0; i < CODE_LEN; i += 1) {
    out += CODE_ALPHABET[randomInt(0, CODE_ALPHABET.length)]
  }
  return out
}

// Issue a fresh code for the account. BCS-DEF-5-TG-WAVE-PARANOIA
// round-1 WARN 3 closure: takes the account-scoped `ttbc:` advisory
// lock INSIDE the same TX as DELETE + INSERT so concurrent
// "Получить код" clicks serialise and produce only ONE active code.
// The same lock-prefix is held by webhook handleStart on consume +
// by cabinet unbind — single key-space, no deadlock potential.
export async function issueTeacherBindCode(
  accountId: string,
): Promise<TeacherBindCodeRow> {
  const pool = getAuthPool()
  const client = await pool.connect()
  try {
    await client.query('begin')
    await client.query(
      `select pg_advisory_xact_lock(hashtextextended('ttbc:' || $1::text, 0))`,
      [accountId],
    )
    const code = generateTeacherBindCode()
    const now = new Date()
    const expiresAt = new Date(now.getTime() + TTL_MS)
    await client.query(
      `delete from teacher_telegram_bind_codes
         where account_id = $1::uuid and consumed_at is null`,
      [accountId],
    )
    const r = await client.query<{
      id: string
      account_id: string
      code: string
      created_at: string
      expires_at: string
      consumed_at: string | null
      consumed_chat_id: string | null
    }>(
      `insert into teacher_telegram_bind_codes
         (account_id, code, created_at, expires_at)
         values ($1::uuid, $2, $3::timestamptz, $4::timestamptz)
         returning id, account_id, code, created_at, expires_at, consumed_at, consumed_chat_id`,
      [accountId, code, now.toISOString(), expiresAt.toISOString()],
    )
    await client.query('commit')
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
  } catch (err) {
    await client.query('rollback').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}
