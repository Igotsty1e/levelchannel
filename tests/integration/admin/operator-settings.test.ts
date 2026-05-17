import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  deleteOperatorSetting,
  resolveOperatorSetting,
  resolveOperatorSettingsForProbe,
  setOperatorSetting,
} from '@/lib/admin/operator-settings'
import {
  createAccount,
  grantAccountRole,
  normalizeAccountEmail,
} from '@/lib/auth/accounts'
import { hashPassword } from '@/lib/auth/password'
import { getDbPool } from '@/lib/db/pool'

import '../setup'

// ALERTS-EDITOR Sub-PR A (2026-05-17) — integration tests for the
// operator_settings resolver + write path. Covers:
//   1. DB hit / env fallback / default fallback / malformed DB row
//      → env fallback.
//   2. Snapshot read (resolveOperatorSettingsForProbe) returns the
//      same answers as single-key resolveOperatorSetting calls.
//   3. setOperatorSetting first-create + UPDATE-via-expectedUpdatedAt.
//   4. setOperatorSetting concurrent-update detection (409 on
//      mismatched expectedUpdatedAt + on first-create race).
//   5. deleteOperatorSetting happy + concurrent-update.
//   6. operator_settings_events row written in same TX as the
//      config write; trigger blocks UPDATE on event rows.

async function makeAdmin(email: string): Promise<string> {
  const acc = await createAccount({
    email: normalizeAccountEmail(email),
    passwordHash: await hashPassword('StrongPassword123'),
  })
  await grantAccountRole(acc.id, 'admin', null)
  return acc.id
}

async function clearOperatorSettings(): Promise<void> {
  const pool = getDbPool()
  // Use a separate connection to avoid TX leftovers from a failed test.
  await pool.query(`delete from operator_settings`)
  // events table: the trigger blocks UPDATE only, DELETE is allowed.
  await pool.query(`delete from operator_settings_events`)
}

beforeEach(async () => {
  await clearOperatorSettings()
})
afterEach(async () => {
  await clearOperatorSettings()
})

describe('resolveOperatorSetting (resolver chain)', () => {
  it('returns default when DB empty and env unset', async () => {
    const r = await resolveOperatorSetting('CALENDAR_PATHOLOGY_THRESHOLD', {} as unknown as NodeJS.ProcessEnv)
    expect(r.source).toBe('default')
    expect(r.value).toBe(3)
  })

  it('returns env when DB empty and env valid', async () => {
    const r = await resolveOperatorSetting('CALENDAR_PATHOLOGY_THRESHOLD', {
      CALENDAR_PATHOLOGY_THRESHOLD: '7',
    } as unknown as NodeJS.ProcessEnv)
    expect(r.source).toBe('env')
    expect(r.value).toBe(7)
  })

  it('returns DB when DB row valid (DB beats env)', async () => {
    const admin = await makeAdmin('os-resolver-db@example.com')
    await setOperatorSetting({
      key: 'CALENDAR_PATHOLOGY_THRESHOLD',
      value: '5',
      expectedUpdatedAt: null,
      byAccountId: admin,
    })
    const r = await resolveOperatorSetting('CALENDAR_PATHOLOGY_THRESHOLD', {
      CALENDAR_PATHOLOGY_THRESHOLD: '7',
    } as unknown as NodeJS.ProcessEnv)
    expect(r.source).toBe('db')
    expect(r.value).toBe(5)
  })

  it('falls back to env when DB row is malformed', async () => {
    // Direct DB insert bypasses validation in the write path so we
    // can simulate a row that's structurally invalid (out of range).
    const pool = getDbPool()
    await pool.query(
      `insert into operator_settings (key, value) values ($1, $2)`,
      ['CALENDAR_PATHOLOGY_THRESHOLD', '999'], // out of [1..100]
    )
    const r = await resolveOperatorSetting('CALENDAR_PATHOLOGY_THRESHOLD', {
      CALENDAR_PATHOLOGY_THRESHOLD: '4',
    } as unknown as NodeJS.ProcessEnv)
    expect(r.source).toBe('env')
    expect(r.value).toBe(4)
    expect(r.rawDb).toBe('999')
  })

  it('decimal knob resolves via env (0.5)', async () => {
    const r = await resolveOperatorSetting('WEBHOOK_FLOW_TERMINATED_RATIO', {
      WEBHOOK_FLOW_TERMINATED_RATIO: '0.5',
    } as unknown as NodeJS.ProcessEnv)
    expect(r.source).toBe('env')
    expect(r.value).toBe(0.5)
  })

  it('decimal knob rejects malformed env (3 decimal places > 2 allowed)', async () => {
    const r = await resolveOperatorSetting('WEBHOOK_FLOW_TERMINATED_RATIO', {
      WEBHOOK_FLOW_TERMINATED_RATIO: '0.333',
    } as unknown as NodeJS.ProcessEnv)
    expect(r.source).toBe('default')
    expect(r.value).toBe(0.3)
  })
})

describe('resolveOperatorSettingsForProbe (snapshot)', () => {
  it('returns all keys for the named probe', async () => {
    const r = await resolveOperatorSettingsForProbe('calendar-pathology', {} as unknown as NodeJS.ProcessEnv)
    expect(Object.keys(r)).toEqual(
      expect.arrayContaining([
        'CALENDAR_PATHOLOGY_THRESHOLD',
        'CALENDAR_PATHOLOGY_REPORT_LIMIT',
        'CALENDAR_PATHOLOGY_DEDUP_WINDOW_MS',
      ]),
    )
    for (const v of Object.values(r)) {
      expect(v.source).toBe('default')
    }
  })

  it('snapshot picks up DB rows in one round-trip', async () => {
    const admin = await makeAdmin('os-snapshot@example.com')
    await setOperatorSetting({
      key: 'AUTH_FLOW_MAX_PER_IP',
      value: '75',
      expectedUpdatedAt: null,
      byAccountId: admin,
    })
    const r = await resolveOperatorSettingsForProbe('auth-flow', {} as unknown as NodeJS.ProcessEnv)
    expect(r.AUTH_FLOW_MAX_PER_IP.source).toBe('db')
    expect(r.AUTH_FLOW_MAX_PER_IP.value).toBe(75)
    expect(r.AUTH_FLOW_WINDOW_MINUTES.source).toBe('default')
  })
})

describe('setOperatorSetting (write path)', () => {
  it('first create succeeds with expectedUpdatedAt=null', async () => {
    const admin = await makeAdmin('os-create@example.com')
    const r = await setOperatorSetting({
      key: 'CALENDAR_PATHOLOGY_THRESHOLD',
      value: '5',
      expectedUpdatedAt: null,
      byAccountId: admin,
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.updatedAt).toBeTruthy()
    // Audit row landed in same TX.
    const pool = getDbPool()
    const events = await pool.query(
      `select event_kind, old_value, new_value
         from operator_settings_events
        where key = $1`,
      ['CALENDAR_PATHOLOGY_THRESHOLD'],
    )
    expect(events.rows.length).toBe(1)
    expect(events.rows[0].event_kind).toBe('set')
    expect(events.rows[0].old_value).toBeNull()
    expect(events.rows[0].new_value).toBe('5')
  })

  it('first create with non-null expectedUpdatedAt fails 409', async () => {
    const admin = await makeAdmin('os-create-stale@example.com')
    const r = await setOperatorSetting({
      key: 'CALENDAR_PATHOLOGY_THRESHOLD',
      value: '5',
      expectedUpdatedAt: new Date().toISOString(),
      byAccountId: admin,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('concurrent_update')
  })

  it('update succeeds with matching expectedUpdatedAt', async () => {
    const admin = await makeAdmin('os-update@example.com')
    const first = await setOperatorSetting({
      key: 'CALENDAR_PATHOLOGY_THRESHOLD',
      value: '5',
      expectedUpdatedAt: null,
      byAccountId: admin,
    })
    expect(first.ok).toBe(true)
    if (!first.ok) throw new Error('first create failed')
    const second = await setOperatorSetting({
      key: 'CALENDAR_PATHOLOGY_THRESHOLD',
      value: '7',
      expectedUpdatedAt: first.updatedAt,
      byAccountId: admin,
    })
    expect(second.ok).toBe(true)

    const pool = getDbPool()
    const events = await pool.query(
      `select event_kind, old_value, new_value
         from operator_settings_events
        where key = $1
        order by ts asc`,
      ['CALENDAR_PATHOLOGY_THRESHOLD'],
    )
    expect(events.rows.length).toBe(2)
    expect(events.rows[1].old_value).toBe('5')
    expect(events.rows[1].new_value).toBe('7')
  })

  it('update with stale expectedUpdatedAt fails 409', async () => {
    const admin = await makeAdmin('os-update-stale@example.com')
    const first = await setOperatorSetting({
      key: 'CALENDAR_PATHOLOGY_THRESHOLD',
      value: '5',
      expectedUpdatedAt: null,
      byAccountId: admin,
    })
    expect(first.ok).toBe(true)
    const stale = await setOperatorSetting({
      key: 'CALENDAR_PATHOLOGY_THRESHOLD',
      value: '9',
      expectedUpdatedAt: '2020-01-01T00:00:00.000Z',
      byAccountId: admin,
    })
    expect(stale.ok).toBe(false)
    if (!stale.ok) expect(stale.reason).toBe('concurrent_update')
  })

  it('rejects invalid value via validation', async () => {
    const admin = await makeAdmin('os-invalid@example.com')
    const r = await setOperatorSetting({
      key: 'CALENDAR_PATHOLOGY_THRESHOLD',
      value: '999', // out of [1..100]
      expectedUpdatedAt: null,
      byAccountId: admin,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('invalid_value')
  })

  it('decimal knob persists with fixed decimal places', async () => {
    const admin = await makeAdmin('os-decimal@example.com')
    const r = await setOperatorSetting({
      key: 'WEBHOOK_FLOW_TERMINATED_RATIO',
      value: '0.5',
      expectedUpdatedAt: null,
      byAccountId: admin,
    })
    expect(r.ok).toBe(true)
    const pool = getDbPool()
    const row = await pool.query(
      `select value from operator_settings where key = $1`,
      ['WEBHOOK_FLOW_TERMINATED_RATIO'],
    )
    expect(row.rows[0].value).toBe('0.50')
  })
})

describe('deleteOperatorSetting (reset to env/default)', () => {
  it('deletes existing row + writes delete event', async () => {
    const admin = await makeAdmin('os-del@example.com')
    const first = await setOperatorSetting({
      key: 'CALENDAR_PATHOLOGY_THRESHOLD',
      value: '5',
      expectedUpdatedAt: null,
      byAccountId: admin,
    })
    if (!first.ok) throw new Error('first create failed')
    const r = await deleteOperatorSetting({
      key: 'CALENDAR_PATHOLOGY_THRESHOLD',
      expectedUpdatedAt: first.updatedAt,
      byAccountId: admin,
    })
    expect(r.ok).toBe(true)
    const pool = getDbPool()
    const events = await pool.query(
      `select event_kind, old_value, new_value
         from operator_settings_events
        where key = $1
        order by ts asc`,
      ['CALENDAR_PATHOLOGY_THRESHOLD'],
    )
    expect(events.rows.length).toBe(2)
    expect(events.rows[1].event_kind).toBe('delete')
    expect(events.rows[1].old_value).toBe('5')
    expect(events.rows[1].new_value).toBeNull()

    // Resolver now falls back to env/default.
    const resolved = await resolveOperatorSetting(
      'CALENDAR_PATHOLOGY_THRESHOLD',
      {} as unknown as NodeJS.ProcessEnv,
    )
    expect(resolved.source).toBe('default')
  })

  it('delete with no existing row fails 409', async () => {
    const admin = await makeAdmin('os-del-missing@example.com')
    const r = await deleteOperatorSetting({
      key: 'CALENDAR_PATHOLOGY_THRESHOLD',
      expectedUpdatedAt: new Date().toISOString(),
      byAccountId: admin,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('concurrent_update')
  })
})

describe('operator_settings_events immutability', () => {
  it('UPDATE on event rows is blocked by the trigger', async () => {
    const admin = await makeAdmin('os-immut@example.com')
    await setOperatorSetting({
      key: 'CALENDAR_PATHOLOGY_THRESHOLD',
      value: '5',
      expectedUpdatedAt: null,
      byAccountId: admin,
    })
    const pool = getDbPool()
    await expect(
      pool.query(
        `update operator_settings_events set new_value = '99' where key = $1`,
        ['CALENDAR_PATHOLOGY_THRESHOLD'],
      ),
    ).rejects.toThrow(/immutable/i)
  })

  it('DELETE on event rows is permitted (for retention sweep)', async () => {
    const admin = await makeAdmin('os-retention@example.com')
    await setOperatorSetting({
      key: 'CALENDAR_PATHOLOGY_THRESHOLD',
      value: '5',
      expectedUpdatedAt: null,
      byAccountId: admin,
    })
    const pool = getDbPool()
    const before = await pool.query(
      `select count(*) as n from operator_settings_events`,
    )
    expect(Number(before.rows[0].n)).toBeGreaterThan(0)
    await pool.query(
      `delete from operator_settings_events where key = $1`,
      ['CALENDAR_PATHOLOGY_THRESHOLD'],
    )
    const after = await pool.query(
      `select count(*) as n from operator_settings_events`,
    )
    expect(Number(after.rows[0].n)).toBe(0)
  })
})
