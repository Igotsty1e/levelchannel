// Concurrent-write race tests for mig 0107's advisory-lock-serialized
// triggers (round-9 BLOCKER 1 + round-10 WARN 2 closure).
//
// Two writers on the same account_id (one PATCH-style clearing
// timezone, one INSERT-style adding an active integration) MUST
// serialize via pg_advisory_xact_lock so the second writer re-reads
// post-commit state instead of passing on a stale READ COMMITTED
// snapshot.
//
// Plan: docs/plans/calendar-onboarding-followup-2026-06-06.md

import { randomUUID } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { createAccount, normalizeAccountEmail } from '@/lib/auth/accounts'
import { hashPassword } from '@/lib/auth/password'
import { upsertAccountProfile } from '@/lib/auth/profiles'
import { getDbPool } from '@/lib/db/pool'

import '../setup'

async function makeTeacherWithMoscow(email: string): Promise<string> {
  const account = await createAccount({
    email: normalizeAccountEmail(email),
    passwordHash: await hashPassword('StrongPassword123'),
  })
  await upsertAccountProfile(account.id, {
    displayName: 'T',
    timezone: 'Europe/Moscow',
    locale: 'ru',
  })
  return account.id
}

describe('mig 0107 concurrent-write race serialization', () => {
  it('forward order: PATCH-clear COMMITs first, INSERT-active reads NULL → rolls back', async () => {
    const accountId = await makeTeacherWithMoscow(
      `race-fwd-${randomUUID().slice(0, 8)}@example.com`,
    )
    const pool = getDbPool()
    const clientA = await pool.connect()
    const clientB = await pool.connect()
    try {
      await clientA.query('BEGIN')
      await clientB.query('BEGIN')

      // clientA acquires the advisory lock on PATCH-clear path.
      await clientA.query(
        `update account_profiles set timezone = null where account_id = $1`,
        [accountId],
      )

      // clientB tries to acquire the lock via the integration insert
      // path. With our deterministic test, we kick off the INSERT then
      // wait briefly to give it a chance to block.
      const bInsertPromise = clientB
        .query(
          `insert into teacher_calendar_integrations (
             account_id, provider, sync_state, epoch, read_calendar_ids, write_calendar_id
           ) values ($1, 'google', 'active', gen_random_uuid()::text, '{}', 'primary')`,
          [accountId],
        )
        .then(() => 'ok' as const)
        .catch((e) => e as Error)

      // Give B a moment to block on the advisory lock.
      await new Promise((r) => setTimeout(r, 100))

      // A commits — the lock releases.
      await clientA.query('COMMIT')

      // B unblocks: SELECT timezone reads committed state (NULL) →
      // trigger raises check_violation.
      const bResult = await bInsertPromise
      expect(bResult).toBeInstanceOf(Error)
      expect((bResult as Error).message).toMatch(/timezone must be set/)
      await clientB.query('ROLLBACK')

      // Final state: profile cleared, integration row absent.
      const profileRow = await pool.query(
        `select timezone from account_profiles where account_id = $1`,
        [accountId],
      )
      expect(profileRow.rows[0].timezone).toBeNull()
      const integrationRow = await pool.query(
        `select count(*)::int as n from teacher_calendar_integrations where account_id = $1`,
        [accountId],
      )
      expect(integrationRow.rows[0].n).toBe(0)
    } finally {
      clientA.release()
      clientB.release()
    }
  })

  it('reverse order: INSERT-active COMMITs first, PATCH-clear reads active → rolls back', async () => {
    const accountId = await makeTeacherWithMoscow(
      `race-rev-${randomUUID().slice(0, 8)}@example.com`,
    )
    const pool = getDbPool()
    const clientA = await pool.connect()
    const clientB = await pool.connect()
    try {
      await clientA.query('BEGIN')
      await clientB.query('BEGIN')

      // clientA acquires the advisory lock on the INSERT-active path.
      await clientA.query(
        `insert into teacher_calendar_integrations (
           account_id, provider, sync_state, epoch, read_calendar_ids, write_calendar_id
         ) values ($1, 'google', 'active', gen_random_uuid()::text, '{}', 'primary')`,
        [accountId],
      )

      // clientB tries to acquire on PATCH-clear path — blocks.
      const bClearPromise = clientB
        .query(
          `update account_profiles set timezone = null where account_id = $1`,
          [accountId],
        )
        .then(() => 'ok' as const)
        .catch((e) => e as Error)

      await new Promise((r) => setTimeout(r, 100))

      await clientA.query('COMMIT')

      // B unblocks: SELECT EXISTS reads committed integration row →
      // trigger raises check_violation.
      const bResult = await bClearPromise
      expect(bResult).toBeInstanceOf(Error)
      expect((bResult as Error).message).toMatch(/cannot clear/)
      await clientB.query('ROLLBACK')

      // Final state: integration='active', profile unchanged (Moscow).
      const profileRow = await pool.query(
        `select timezone from account_profiles where account_id = $1`,
        [accountId],
      )
      expect(profileRow.rows[0].timezone).toBe('Europe/Moscow')
      const integrationRow = await pool.query(
        `select sync_state from teacher_calendar_integrations where account_id = $1`,
        [accountId],
      )
      expect(integrationRow.rows[0].sync_state).toBe('active')
    } finally {
      clientA.release()
      clientB.release()
    }
  })
})
