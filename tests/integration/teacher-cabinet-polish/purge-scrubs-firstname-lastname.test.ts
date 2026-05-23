// TASK-5 (mig 0095) — retention purge sweep nulls first_name + last_name.
//
// 152-FZ erasure: account_profiles must surface NO residual PII on
// purge. Mirrors tests/integration/scripts/db-retention-cleanup-telegram.test.ts
// pattern (subprocess invocation of the mjs cleanup script).

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { describe, expect, it } from 'vitest'

import {
  createAccount,
  normalizeAccountEmail,
} from '@/lib/auth/accounts'
import { hashPassword } from '@/lib/auth/password'
import { getDbPool } from '@/lib/db/pool'

import '../setup'

const execFileP = promisify(execFile)

describe('TASK-5 — retention purge zeros first_name + last_name', () => {
  it('account with first/last/display set + scheduled_purge_at past → after sweep, all 3 columns NULL', async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL must be set for integration tests')
    }

    const id = await createAccount({
      email: normalizeAccountEmail(
        `tcp-purge-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`,
      ),
      passwordHash: await hashPassword('StrongPassword123'),
    }).then((a) => a.id)

    // Seed the profile with all 3 name fields populated.
    await getDbPool().query(
      `insert into account_profiles
         (account_id, display_name, first_name, last_name, timezone, locale)
         values ($1, 'Иван Петров', 'Иван', 'Петров', 'Europe/Moscow', 'ru')
       on conflict (account_id) do update
         set display_name = excluded.display_name,
             first_name = excluded.first_name,
             last_name = excluded.last_name`,
      [id],
    )

    // Arm for purge.
    await getDbPool().query(
      `update accounts
          set disabled_at = now() - interval '60 days',
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
      `select display_name, first_name, last_name, timezone, locale
         from account_profiles where account_id = $1::uuid`,
      [id],
    )
    expect(r.rows.length).toBe(1)
    expect(r.rows[0].display_name).toBeNull()
    expect(r.rows[0].first_name).toBeNull()
    expect(r.rows[0].last_name).toBeNull()
    expect(r.rows[0].timezone).toBeNull()
    expect(r.rows[0].locale).toBeNull()

    // Account row also scrubbed.
    const a = await getDbPool().query(
      `select email, password_hash, purged_at from accounts where id = $1::uuid`,
      [id],
    )
    expect(String(a.rows[0].email)).toMatch(/^deleted-.*@example\.invalid$/)
    expect(String(a.rows[0].password_hash)).toBe('PURGED')
    expect(a.rows[0].purged_at).not.toBeNull()
  }, 30_000)
})
