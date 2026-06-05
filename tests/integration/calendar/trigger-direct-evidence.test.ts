// Direct DB-trigger evidence tests for mig 0107.
//
// Round-6 WARN 5 + round-9 BLOCKER 1 closure: prove the trigger pair
// IS the load-bearing defense at DB layer, independent of route-level
// remap tests. Each test fires raw SQL against the pool and asserts
// the trigger raises the expected check_violation.
//
// Plan: docs/plans/calendar-onboarding-followup-2026-06-06.md

import { randomUUID } from 'node:crypto'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createAccount, normalizeAccountEmail } from '@/lib/auth/accounts'
import { hashPassword } from '@/lib/auth/password'
import { upsertAccountProfile } from '@/lib/auth/profiles'
import { __resetCalendarEncryptionKeyCache } from '@/lib/calendar/encryption'
import { upsertGoogleIntegration } from '@/lib/calendar/integrations'
import { getDbPool } from '@/lib/db/pool'

import '../setup'

const TEST_KEY = 'k'.repeat(48)

async function makeTeacher(
  email: string,
  opts: { timezone?: string | null } = {},
): Promise<string> {
  const account = await createAccount({
    email: normalizeAccountEmail(email),
    passwordHash: await hashPassword('StrongPassword123'),
  })
  if (opts.timezone !== null) {
    await upsertAccountProfile(account.id, {
      displayName: 'T',
      timezone: opts.timezone ?? 'Europe/Moscow',
      locale: 'ru',
    })
  }
  return account.id
}

async function makeActiveIntegration(accountId: string) {
  process.env.CALENDAR_ENCRYPTION_KEY = TEST_KEY
  __resetCalendarEncryptionKeyCache()
  const r = await upsertGoogleIntegration({
    accountId,
    accessToken: 'A',
    refreshToken: 'R',
    scope: 'scope',
    tokenExpiresAt: new Date(Date.now() + 3600_000),
    readCalendarIds: ['primary'],
    writeCalendarId: 'primary',
    reason: 'initial_connect',
  })
  expect(r.ok).toBe(true)
}

beforeEach(() => {
  process.env.CALENDAR_ENCRYPTION_KEY = TEST_KEY
  __resetCalendarEncryptionKeyCache()
})

afterEach(() => {
  delete process.env.CALENDAR_ENCRYPTION_KEY
  __resetCalendarEncryptionKeyCache()
})

describe('mig 0107 — direct DB trigger evidence', () => {
  it('Trigger A: INSERT teacher_calendar_integrations(active) with profile.timezone=NULL → check_violation', async () => {
    const accountId = await makeTeacher(
      `mig0107-tcia-null-${randomUUID().slice(0, 8)}@example.com`,
      { timezone: null },
    )
    const pool = getDbPool()
    await expect(
      pool.query(
        `insert into teacher_calendar_integrations (
           account_id, provider, sync_state, epoch, read_calendar_ids, write_calendar_id
         ) values ($1, 'google', 'active', gen_random_uuid()::text, '{}', 'primary')`,
        [accountId],
      ),
    ).rejects.toThrow(/timezone must be set/)
  })

  it('Trigger B (UPDATE): clear timezone via raw SQL while active integration exists → check_violation', async () => {
    const accountId = await makeTeacher(
      `mig0107-clear-${randomUUID().slice(0, 8)}@example.com`,
    )
    await makeActiveIntegration(accountId)
    const pool = getDbPool()
    await expect(
      pool.query(
        `update account_profiles set timezone = null where account_id = $1`,
        [accountId],
      ),
    ).rejects.toThrow(/cannot clear/)
  })

  it('Trigger B (DELETE): remove profile row while active integration exists → check_violation', async () => {
    const accountId = await makeTeacher(
      `mig0107-delete-${randomUUID().slice(0, 8)}@example.com`,
    )
    await makeActiveIntegration(accountId)
    const pool = getDbPool()
    await expect(
      pool.query(`delete from account_profiles where account_id = $1`, [
        accountId,
      ]),
    ).rejects.toThrow(/cannot remove/)
  })

  it('non-active integration writes do NOT trigger', async () => {
    const accountId = await makeTeacher(
      `mig0107-notactive-${randomUUID().slice(0, 8)}@example.com`,
      { timezone: null },
    )
    const pool = getDbPool()
    const r = await pool.query(
      `insert into teacher_calendar_integrations (
         account_id, provider, sync_state, epoch, read_calendar_ids, write_calendar_id
       ) values ($1, 'google', 'disconnected', gen_random_uuid()::text, '{}', null)
       returning account_id`,
      [accountId],
    )
    expect(r.rowCount).toBe(1)
  })

  it('active→active UPDATE re-validates timezone (round-3 BLOCKER 2: drop state_changing optimisation)', async () => {
    const accountId = await makeTeacher(
      `mig0107-reassert-${randomUUID().slice(0, 8)}@example.com`,
    )
    await makeActiveIntegration(accountId)
    const pool = getDbPool()
    // Bypass triggers temporarily to test the re-validate path. We
    // disable session_replication_role to skip user triggers, NULL the
    // tz, then re-enable. This puts the DB in the inconsistent state
    // the race would create.
    await pool.query(`set session session_replication_role = 'replica'`)
    await pool.query(
      `update account_profiles set timezone = null where account_id = $1`,
      [accountId],
    )
    await pool.query(`set session session_replication_role = 'origin'`)
    // Now any UPDATE on the active|degraded integration that touches
    // sync_state should fire trigger A's re-check.
    await expect(
      pool.query(
        `update teacher_calendar_integrations set sync_state = 'active' where account_id = $1`,
        [accountId],
      ),
    ).rejects.toThrow(/timezone must be set/)
    // Clean up the bypassed state.
    await pool.query(`set session session_replication_role = 'replica'`)
    await pool.query(
      `update account_profiles set timezone = 'Europe/Moscow' where account_id = $1`,
      [accountId],
    )
    await pool.query(`set session session_replication_role = 'origin'`)
  })
})
