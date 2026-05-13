import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createAccount,
  grantAccountRole,
  normalizeAccountEmail,
} from '@/lib/auth/accounts'
import { hashPassword } from '@/lib/auth/password'
import { upsertAccountProfile } from '@/lib/auth/profiles'
import { __resetCalendarEncryptionKeyCache } from '@/lib/calendar/encryption'
import {
  getGoogleIntegrationMeta,
  upsertGoogleIntegration,
} from '@/lib/calendar/integrations'
import { runPullForCalendar } from '@/lib/calendar/pull-runner'
import { getDbPool } from '@/lib/db/pool'

import '../setup'

const TEST_KEY = 'k'.repeat(48)

function mockEventsListResponse(items: unknown[]): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ items }),
    text: async () => JSON.stringify({ items }),
  } as unknown as Response
}

beforeEach(() => {
  process.env.CALENDAR_ENCRYPTION_KEY = TEST_KEY
  __resetCalendarEncryptionKeyCache()
})
afterEach(() => {
  delete process.env.CALENDAR_ENCRYPTION_KEY
  __resetCalendarEncryptionKeyCache()
  vi.unstubAllGlobals()
})

async function makeTeacher(email: string): Promise<string> {
  const account = await createAccount({
    email: normalizeAccountEmail(email),
    passwordHash: await hashPassword('StrongPassword123'),
  })
  await grantAccountRole(account.id, 'teacher', null)
  await upsertAccountProfile(account.id, {
    displayName: 'T',
    timezone: 'Europe/Moscow',
    locale: 'ru',
  })
  return account.id
}

async function connect(accountId: string): Promise<void> {
  const r = await upsertGoogleIntegration({
    accountId,
    accessToken: 'AT',
    refreshToken: 'RT',
    scope: 's',
    tokenExpiresAt: new Date(Date.now() + 3600_000),
    readCalendarIds: ['primary'],
    writeCalendarId: 'primary',
    reason: 'initial_connect',
  })
  expect(r.ok).toBe(true)
}

async function createSlot(teacherId: string, startAt: string): Promise<string> {
  const pool = getDbPool()
  const r = await pool.query(
    `insert into lesson_slots (id, teacher_account_id, start_at, duration_minutes, status)
     values (gen_random_uuid(), $1, $2::timestamptz, 60, 'open')
     returning id`,
    [teacherId, startAt],
  )
  return String(r.rows[0].id)
}

describe('runPullForCalendar', () => {
  it('full-rewrite: pull replaces existing busy intervals for this (teacher, calendar)', async () => {
    const teacherId = await makeTeacher('teacher-pull-1@example.com')
    await connect(teacherId)

    const pool = getDbPool()
    // Seed an existing stale row.
    await pool.query(
      `insert into teacher_external_busy_intervals
         (id, teacher_account_id, external_calendar_id, external_event_id,
          start_at, end_at, fetched_at)
       values (
         gen_random_uuid(), $1, 'primary', 'STALE',
         now() + interval '1 day', now() + interval '1 day' + interval '30 min',
         now() - interval '1 day'
       )`,
      [teacherId],
    )

    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        mockEventsListResponse([
          {
            id: 'EVT_A',
            summary: 'Meeting',
            start: { dateTime: '2026-06-01T09:00:00Z' },
            end: { dateTime: '2026-06-01T10:00:00Z' },
          },
        ]),
      ),
    )

    const r = await runPullForCalendar({
      teacherAccountId: teacherId,
      externalCalendarId: 'primary',
      isWritableInSource: true,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.intervalsBefore).toBe(1)
      expect(r.intervalsAfter).toBe(1)
      expect(r.ownEvents).toBe(0)
      expect(r.orphanSelf).toBe(0)
    }

    const rows = await pool.query(
      `select external_event_id, is_writable_in_source, is_own_event, is_orphan_self
         from teacher_external_busy_intervals
        where teacher_account_id = $1`,
      [teacherId],
    )
    expect(rows.rows).toHaveLength(1)
    expect(rows.rows[0].external_event_id).toBe('EVT_A')
    expect(rows.rows[0].is_writable_in_source).toBe(true)
    expect(rows.rows[0].is_own_event).toBe(false)
    expect(rows.rows[0].is_orphan_self).toBe(false)

    const meta = await getGoogleIntegrationMeta(teacherId)
    expect(meta?.lastPulledAt).not.toBeNull()
    expect(meta?.syncState).toBe('active')
  })

  it('marks is_own_event=true when shared.lc_* matches current epoch', async () => {
    const teacherId = await makeTeacher('teacher-pull-own@example.com')
    await connect(teacherId)
    const meta = await getGoogleIntegrationMeta(teacherId)
    const currentEpoch = meta!.epoch
    const slotId = await createSlot(teacherId, '2026-06-02T09:00:00Z')

    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        mockEventsListResponse([
          {
            id: 'LC_PUSHED',
            summary: 'LC',
            start: { dateTime: '2026-06-02T09:00:00Z' },
            end: { dateTime: '2026-06-02T10:00:00Z' },
            extendedProperties: {
              shared: {
                lc_origin: 'levelchannel',
                lc_slot_id: slotId,
                lc_epoch: currentEpoch,
              },
            },
          },
        ]),
      ),
    )
    const r = await runPullForCalendar({
      teacherAccountId: teacherId,
      externalCalendarId: 'primary',
      isWritableInSource: true,
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.ownEvents).toBe(1)

    const row = await getDbPool().query(
      `select is_own_event, is_orphan_self
         from teacher_external_busy_intervals where external_event_id = $1`,
      ['LC_PUSHED'],
    )
    expect(row.rows[0].is_own_event).toBe(true)
    expect(row.rows[0].is_orphan_self).toBe(false)
  })

  it('marks is_orphan_self=true when lc_epoch is from a previous session', async () => {
    const teacherId = await makeTeacher('teacher-pull-orph@example.com')
    await connect(teacherId)
    const slotId = await createSlot(teacherId, '2026-06-02T09:00:00Z')

    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        mockEventsListResponse([
          {
            id: 'LC_OLD_EPOCH',
            start: { dateTime: '2026-06-02T09:00:00Z' },
            end: { dateTime: '2026-06-02T10:00:00Z' },
            extendedProperties: {
              shared: {
                lc_origin: 'levelchannel',
                lc_slot_id: slotId,
                lc_epoch: 'PREVIOUS_EPOCH_NOT_CURRENT',
              },
            },
          },
        ]),
      ),
    )
    const r = await runPullForCalendar({
      teacherAccountId: teacherId,
      externalCalendarId: 'primary',
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.ownEvents).toBe(0)
      expect(r.orphanSelf).toBe(1)
    }
  })

  it('does NOT treat a foreign-account slot id as own_event (security defense)', async () => {
    const teacherA = await makeTeacher('teacher-pull-secA@example.com')
    const teacherB = await makeTeacher('teacher-pull-secB@example.com')
    await connect(teacherA)
    const metaA = await getGoogleIntegrationMeta(teacherA)
    // Slot belongs to teacherB, not teacherA — must NOT match.
    const foreignSlotId = await createSlot(teacherB, '2026-06-02T09:00:00Z')

    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        mockEventsListResponse([
          {
            id: 'SPOOFED',
            start: { dateTime: '2026-06-02T09:00:00Z' },
            end: { dateTime: '2026-06-02T10:00:00Z' },
            extendedProperties: {
              shared: {
                lc_origin: 'levelchannel',
                lc_slot_id: foreignSlotId,
                lc_epoch: metaA!.epoch,
              },
            },
          },
        ]),
      ),
    )
    const r = await runPullForCalendar({
      teacherAccountId: teacherA,
      externalCalendarId: 'primary',
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.ownEvents).toBe(0)
      expect(r.orphanSelf).toBe(0)
    }
  })

  it('empty pull clears all previous busy intervals (full-rewrite semantics)', async () => {
    const teacherId = await makeTeacher('teacher-pull-empty@example.com')
    await connect(teacherId)
    const pool = getDbPool()
    await pool.query(
      `insert into teacher_external_busy_intervals
         (id, teacher_account_id, external_calendar_id, external_event_id,
          start_at, end_at, fetched_at)
       values (gen_random_uuid(), $1, 'primary', 'OLD', now()+interval '1 day',
               now()+interval '1 day' + interval '30 min', now())`,
      [teacherId],
    )

    vi.stubGlobal('fetch', vi.fn(async () => mockEventsListResponse([])))
    const r = await runPullForCalendar({
      teacherAccountId: teacherId,
      externalCalendarId: 'primary',
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.intervalsBefore).toBe(1)
      expect(r.intervalsAfter).toBe(0)
    }
    const rows = await pool.query(
      'select count(*)::int as n from teacher_external_busy_intervals where teacher_account_id = $1',
      [teacherId],
    )
    expect(rows.rows[0].n).toBe(0)
  })

  it('refuses on disconnected integration', async () => {
    const teacherId = await makeTeacher('teacher-pull-disc@example.com')
    await connect(teacherId)
    const pool = getDbPool()
    await pool.query(
      `update teacher_calendar_integrations set sync_state = 'disconnected', access_token_enc = null where account_id = $1`,
      [teacherId],
    )
    const r = await runPullForCalendar({
      teacherAccountId: teacherId,
      externalCalendarId: 'primary',
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.kind).toBe('integration_disconnected')
  })

  it('refuses on missing integration', async () => {
    const teacherId = await makeTeacher('teacher-pull-miss@example.com')
    // no connect call
    const r = await runPullForCalendar({
      teacherAccountId: teacherId,
      externalCalendarId: 'primary',
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.kind).toBe('integration_missing')
  })

  it('refuses on expired access token', async () => {
    const teacherId = await makeTeacher('teacher-pull-exp@example.com')
    await connect(teacherId)
    const pool = getDbPool()
    await pool.query(
      `update teacher_calendar_integrations set token_expires_at = now() - interval '1 hour' where account_id = $1`,
      [teacherId],
    )
    const r = await runPullForCalendar({
      teacherAccountId: teacherId,
      externalCalendarId: 'primary',
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.kind).toBe('access_token_expired')
  })

  it('propagates Google HTTP error', async () => {
    const teacherId = await makeTeacher('teacher-pull-http@example.com')
    await connect(teacherId)
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          ({
            ok: false,
            status: 401,
            text: async () => 'unauthorized',
            json: async () => ({}),
          }) as unknown as Response,
      ),
    )
    const r = await runPullForCalendar({
      teacherAccountId: teacherId,
      externalCalendarId: 'primary',
    })
    expect(r.ok).toBe(false)
    if (!r.ok && r.error.kind === 'http') expect(r.error.status).toBe(401)
  })

  it('stores summary encrypted (not plaintext on disk)', async () => {
    const teacherId = await makeTeacher('teacher-pull-sum@example.com')
    await connect(teacherId)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        mockEventsListResponse([
          {
            id: 'EVT_SUM',
            summary: 'Top secret meeting',
            start: { dateTime: '2026-06-02T09:00:00Z' },
            end: { dateTime: '2026-06-02T10:00:00Z' },
          },
        ]),
      ),
    )
    const r = await runPullForCalendar({
      teacherAccountId: teacherId,
      externalCalendarId: 'primary',
    })
    expect(r.ok).toBe(true)
    const row = await getDbPool().query(
      `select summary_encrypted::text as enc from teacher_external_busy_intervals
        where external_event_id = $1`,
      ['EVT_SUM'],
    )
    expect(row.rows[0].enc).not.toContain('Top secret')
    // Decrypt via pgcrypto to confirm round-trip.
    const dec = await getDbPool().query(
      `select pgp_sym_decrypt(summary_encrypted, $2::text) as plain
         from teacher_external_busy_intervals where external_event_id = $1`,
      ['EVT_SUM', TEST_KEY],
    )
    expect(dec.rows[0].plain).toBe('Top secret meeting')
  })

  it('flips sync_state from degraded back to active on a successful pull', async () => {
    const teacherId = await makeTeacher('teacher-pull-recover@example.com')
    await connect(teacherId)
    const pool = getDbPool()
    await pool.query(
      `update teacher_calendar_integrations set sync_state = 'degraded' where account_id = $1`,
      [teacherId],
    )
    vi.stubGlobal('fetch', vi.fn(async () => mockEventsListResponse([])))
    const r = await runPullForCalendar({
      teacherAccountId: teacherId,
      externalCalendarId: 'primary',
    })
    expect(r.ok).toBe(true)
    const meta = await getGoogleIntegrationMeta(teacherId)
    expect(meta?.syncState).toBe('active')
  })
})
