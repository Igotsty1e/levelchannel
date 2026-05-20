import { describe, expect, it } from 'vitest'

import {
  createAccount,
  normalizeAccountEmail,
} from '@/lib/auth/accounts'
import { hashPassword } from '@/lib/auth/password'
import { getDbPool } from '@/lib/db/pool'

import '../setup'

// BCS-DEF-4 (2026-05-19) — pin the CHECK constraints added by
// migration 0065 (`accounts_learner_telegram_consistency` +
// `accounts_learner_telegram_chat_id_len`).
//
// Plan: docs/plans/bcs-def-4-learner-reminders.md §3.3.

async function makeLearner(prefix: string): Promise<string> {
  const id = await createAccount({
    email: normalizeAccountEmail(
      `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`,
    ),
    passwordHash: await hashPassword('StrongPassword123'),
  }).then((a) => a.id)
  return id
}

describe('migration 0065 — accounts TG opt-in CHECK constraints', () => {
  it('default new-account row has enabled=false + chat_id=NULL', async () => {
    const id = await makeLearner('lrd-tg-def')
    const r = await getDbPool().query(
      `select learner_telegram_enabled, learner_telegram_chat_id
         from accounts where id = $1::uuid`,
      [id],
    )
    expect(r.rows[0]).toBeTruthy()
    expect(r.rows[0].learner_telegram_enabled).toBe(false)
    expect(r.rows[0].learner_telegram_chat_id).toBeNull()
  }, 30_000)

  it('UPDATE enabled=true with chat_id=NULL → CHECK violation (accounts_learner_telegram_consistency)', async () => {
    const id = await makeLearner('lrd-tg-bad1')
    await expect(
      getDbPool().query(
        `update accounts
            set learner_telegram_enabled = true
          where id = $1::uuid`,
        [id],
      ),
    ).rejects.toThrow(/accounts_learner_telegram_consistency|violates check/i)
  }, 30_000)

  it('UPDATE chat_id to a 65-char string → CHECK violation (chat_id_len)', async () => {
    const id = await makeLearner('lrd-tg-bad2')
    await expect(
      getDbPool().query(
        `update accounts
            set learner_telegram_chat_id = repeat('x', 65)
          where id = $1::uuid`,
        [id],
      ),
    ).rejects.toThrow(/accounts_learner_telegram_chat_id_len|violates check/i)
  }, 30_000)

  it('UPDATE enabled=true + chat_id="12345" → accepted; round-trip via SELECT', async () => {
    const id = await makeLearner('lrd-tg-ok')
    await getDbPool().query(
      `update accounts
          set learner_telegram_enabled = true,
              learner_telegram_chat_id = '12345'
        where id = $1::uuid`,
      [id],
    )
    const r = await getDbPool().query(
      `select learner_telegram_enabled, learner_telegram_chat_id
         from accounts where id = $1::uuid`,
      [id],
    )
    expect(r.rows[0].learner_telegram_enabled).toBe(true)
    expect(r.rows[0].learner_telegram_chat_id).toBe('12345')
  }, 30_000)
})
