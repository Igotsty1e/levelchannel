import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest'

import {
  createAccount,
  normalizeAccountEmail,
} from '@/lib/auth/accounts'
import { hashPassword } from '@/lib/auth/password'
import { getDbPool } from '@/lib/db/pool'

import '../setup'

// BCS-DEF-4 (2026-05-19) — pin the retention-sweep extension that
// zeros learner_telegram_{enabled,chat_id} alongside email/
// password_hash on purge. Defense-in-depth against residual PII
// per 152-FZ (the scheduler SELECT gate is the primary protection).
//
// Plan: docs/plans/bcs-def-4-learner-reminders.md §2.2.1 + §3.3.1.

const execFileP = promisify(execFile)

beforeEach(async () => {
  // No-op: setup.ts truncates accounts in afterEach.
})

afterEach(async () => {
  await getDbPool().query(`delete from operator_settings where key like 'LEARNER%'`)
})

describe('scripts/db-retention-cleanup.mjs — TG columns zeroed on purge', () => {
  it('learner with enabled=true + chat_id set + scheduled_purge_at past → after sweep, enabled=false + chat_id=null + purged_at set', async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL must be set for integration tests')
    }

    const id = await createAccount({
      email: normalizeAccountEmail(
        `lrd-purge-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`,
      ),
      passwordHash: await hashPassword('StrongPassword123'),
    }).then((a) => a.id)

    // Opt in + arm for purge.
    await getDbPool().query(
      `update accounts
          set learner_telegram_enabled = true,
              learner_telegram_chat_id = '12345',
              disabled_at = now() - interval '60 days',
              scheduled_purge_at = now() - interval '1 minute',
              purged_at = null
        where id = $1::uuid`,
      [id],
    )

    await execFileP(
      process.execPath,
      ['scripts/db-retention-cleanup.mjs'],
      { env: process.env, cwd: process.cwd() },
    )

    const r = await getDbPool().query(
      `select email, password_hash, learner_telegram_enabled,
              learner_telegram_chat_id, purged_at
         from accounts where id = $1::uuid`,
      [id],
    )
    const row = r.rows[0]
    expect(row).toBeTruthy()
    expect(row.learner_telegram_enabled).toBe(false)
    expect(row.learner_telegram_chat_id).toBeNull()
    expect(row.purged_at).not.toBeNull()
    expect(String(row.email)).toMatch(/^deleted-.*@example\.invalid$/)
    expect(String(row.password_hash)).toBe('PURGED')
  }, 30_000)
})
