import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createAccount,
  grantAccountRole,
  normalizeAccountEmail,
} from '@/lib/auth/accounts'
import { hashPassword } from '@/lib/auth/password'
import { upsertAccountProfile } from '@/lib/auth/profiles'
import { __resetCalendarEncryptionKeyCache } from '@/lib/calendar/encryption'
import { __resetGoogleCalendarOauthConfigCache } from '@/lib/calendar/google/config'
import { deterministicEventId } from '@/lib/calendar/google/push'
import { upsertGoogleIntegration } from '@/lib/calendar/integrations'
import {
  drainPushJobs,
  enqueueCreatePushIfIntegrationActive,
  enqueuePushJob,
} from '@/lib/calendar/push-worker'
import { getDbPool } from '@/lib/db/pool'

import '../setup'

const TEST_KEY = 'k'.repeat(48)

function jsonResp(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response
}

beforeEach(() => {
  process.env.CALENDAR_ENCRYPTION_KEY = TEST_KEY
  process.env.GOOGLE_CALENDAR_CLIENT_ID = 'cid'
  process.env.GOOGLE_CALENDAR_CLIENT_SECRET = 'csec'
  process.env.GOOGLE_CALENDAR_REDIRECT_URL =
    'https://lc.test/api/teacher/calendar/google/callback'
  process.env.GOOGLE_OAUTH_STATE_SECRET = 'oauth-state-' + 'x'.repeat(32)
  __resetCalendarEncryptionKeyCache()
  __resetGoogleCalendarOauthConfigCache()
})
afterEach(() => {
  delete process.env.CALENDAR_ENCRYPTION_KEY
  delete process.env.GOOGLE_CALENDAR_CLIENT_ID
  delete process.env.GOOGLE_CALENDAR_CLIENT_SECRET
  delete process.env.GOOGLE_CALENDAR_REDIRECT_URL
  delete process.env.GOOGLE_OAUTH_STATE_SECRET
  __resetCalendarEncryptionKeyCache()
  __resetGoogleCalendarOauthConfigCache()
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
  await upsertGoogleIntegration({
    accountId,
    accessToken: 'AT',
    refreshToken: 'RT',
    scope: 's',
    tokenExpiresAt: new Date(Date.now() + 3600_000),
    readCalendarIds: ['primary'],
    writeCalendarId: 'primary',
    reason: 'initial_connect',
  })
}

async function bookedSlot(
  teacherId: string,
  startIso: string,
  duration = 60,
): Promise<string> {
  const r = await getDbPool().query(
    `insert into lesson_slots (id, teacher_account_id, start_at, duration_minutes, status,
                                learner_account_id, booked_at)
     values (gen_random_uuid(), $1, $2::timestamptz, $3, 'booked', $1, now())
     returning id`,
    [teacherId, startIso, duration],
  )
  return String(r.rows[0].id)
}

describe('drainPushJobs', () => {
  it('happy create: events.insert succeeds, slot binding persisted', async () => {
    const teacherId = await makeTeacher('pw-create@example.com')
    await connect(teacherId)
    const slotId = await bookedSlot(teacherId, '2026-10-01T10:00:00Z')
    await enqueuePushJob({
      slotId,
      teacherAccountId: teacherId,
      kind: 'create',
      payload: { write_calendar_id: 'primary', lc_epoch: 'e' },
    })
    const expectedEventId = deterministicEventId(slotId)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResp({
          id: expectedEventId,
          etag: '"e"',
          extendedProperties: {
            shared: {
              lc_origin: 'levelchannel',
              lc_slot_id: slotId,
              lc_epoch: 'e',
            },
          },
        }),
      ),
    )
    const { outcomes } = await drainPushJobs({})
    expect(outcomes[0].kind).toBe('succeeded')

    const row = await getDbPool().query(
      'select external_event_id, external_calendar_id, integration_epoch from lesson_slots where id = $1',
      [slotId],
    )
    expect(row.rows[0].external_event_id).toBe(expectedEventId)
    expect(row.rows[0].external_calendar_id).toBe('primary')
  })

  it('create on already-cancelled slot → cancelled_by_dependent (no insert)', async () => {
    const teacherId = await makeTeacher('pw-cbd@example.com')
    await connect(teacherId)
    const pool = getDbPool()
    const slotR = await pool.query(
      `insert into lesson_slots (id, teacher_account_id, start_at, duration_minutes, status, cancelled_at)
       values (gen_random_uuid(), $1, $2::timestamptz, 60, 'cancelled', now())
       returning id`,
      [teacherId, '2026-10-02T10:00:00Z'],
    )
    const slotId = String(slotR.rows[0].id)
    await enqueuePushJob({
      slotId,
      teacherAccountId: teacherId,
      kind: 'create',
      payload: { write_calendar_id: 'primary', lc_epoch: 'e' },
    })
    const fetchMock = vi.fn(async () => jsonResp({ id: 'x', etag: '' }))
    vi.stubGlobal('fetch', fetchMock)
    const { outcomes } = await drainPushJobs({})
    expect(outcomes[0].kind).toBe('cancelled_by_dependent')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('delete: 200/204/404/410 all terminal-success', async () => {
    const teacherId = await makeTeacher('pw-del@example.com')
    await connect(teacherId)
    const slotId = await bookedSlot(teacherId, '2026-10-03T10:00:00Z')
    const pool = getDbPool()
    await pool.query(
      `update lesson_slots set external_event_id = 'evt-bound', external_calendar_id = 'primary' where id = $1`,
      [slotId],
    )
    await enqueuePushJob({
      slotId,
      teacherAccountId: teacherId,
      kind: 'delete',
      payload: { write_calendar_id: 'primary' },
    })
    vi.stubGlobal('fetch', vi.fn(async () => jsonResp('', 410)))
    const { outcomes } = await drainPushJobs({})
    expect(outcomes[0].kind).toBe('succeeded')

    const row = await pool.query(
      'select external_event_id from lesson_slots where id = $1',
      [slotId],
    )
    expect(row.rows[0].external_event_id).toBeNull()
  })

  it('delete on slot with NO external_event_id falls back to deterministic id', async () => {
    const teacherId = await makeTeacher('pw-deldet@example.com')
    await connect(teacherId)
    const slotId = await bookedSlot(teacherId, '2026-10-04T10:00:00Z')
    const expectedId = deterministicEventId(slotId)
    let urlSeen = ''
    await getDbPool().query(
      `update lesson_slots set status = 'cancelled', cancelled_at = now() where id = $1`,
      [slotId],
    )
    await enqueuePushJob({
      slotId,
      teacherAccountId: teacherId,
      kind: 'delete',
      payload: { write_calendar_id: 'primary' },
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: RequestInfo | URL) => {
        urlSeen = String(url)
        return jsonResp('', 204)
      }),
    )
    await drainPushJobs({})
    expect(urlSeen).toContain(encodeURIComponent(expectedId))
  })

  it('retries on http 5xx', async () => {
    const teacherId = await makeTeacher('pw-5xx@example.com')
    await connect(teacherId)
    const slotId = await bookedSlot(teacherId, '2026-10-05T10:00:00Z')
    await enqueuePushJob({
      slotId,
      teacherAccountId: teacherId,
      kind: 'create',
      payload: { write_calendar_id: 'primary', lc_epoch: 'e' },
    })
    vi.stubGlobal('fetch', vi.fn(async () => jsonResp('outage', 503)))
    const { outcomes } = await drainPushJobs({})
    expect(outcomes[0].kind).toBe('retried')
  })

  it('terminal_failure on http 4xx (non-quota)', async () => {
    const teacherId = await makeTeacher('pw-4xx@example.com')
    await connect(teacherId)
    const slotId = await bookedSlot(teacherId, '2026-10-06T10:00:00Z')
    await enqueuePushJob({
      slotId,
      teacherAccountId: teacherId,
      kind: 'create',
      payload: { write_calendar_id: 'primary', lc_epoch: 'e' },
    })
    vi.stubGlobal('fetch', vi.fn(async () => jsonResp('bad request', 400)))
    const { outcomes } = await drainPushJobs({})
    expect(outcomes[0].kind).toBe('terminal_failure')
  })
})

describe('enqueueCreatePushIfIntegrationActive', () => {
  it('enqueues when integration is active with write_calendar_id', async () => {
    const teacherId = await makeTeacher('enq-active@example.com')
    await connect(teacherId)
    const slotId = await bookedSlot(teacherId, '2026-10-07T10:00:00Z')
    const r = await enqueueCreatePushIfIntegrationActive({
      slotId,
      teacherAccountId: teacherId,
    })
    expect(r.enqueued).toBe(true)
    const count = await getDbPool().query(
      'select count(*)::int as n from calendar_push_jobs where slot_id = $1',
      [slotId],
    )
    expect(count.rows[0].n).toBe(1)
  })

  it('no-op when integration is disconnected', async () => {
    const teacherId = await makeTeacher('enq-disc@example.com')
    await connect(teacherId)
    await getDbPool().query(
      `update teacher_calendar_integrations set sync_state = 'disconnected' where account_id = $1`,
      [teacherId],
    )
    const slotId = await bookedSlot(teacherId, '2026-10-08T10:00:00Z')
    const r = await enqueueCreatePushIfIntegrationActive({
      slotId,
      teacherAccountId: teacherId,
    })
    expect(r.enqueued).toBe(false)
  })

  it('no-op when no integration row exists', async () => {
    const teacherId = await makeTeacher('enq-none@example.com')
    // No connect call.
    const slotId = await bookedSlot(teacherId, '2026-10-09T10:00:00Z')
    const r = await enqueueCreatePushIfIntegrationActive({
      slotId,
      teacherAccountId: teacherId,
    })
    expect(r.enqueued).toBe(false)
  })

  it('no-op when write_calendar_id is null', async () => {
    const teacherId = await makeTeacher('enq-nowc@example.com')
    await connect(teacherId)
    await getDbPool().query(
      `update teacher_calendar_integrations set write_calendar_id = null where account_id = $1`,
      [teacherId],
    )
    const slotId = await bookedSlot(teacherId, '2026-10-10T10:00:00Z')
    const r = await enqueueCreatePushIfIntegrationActive({
      slotId,
      teacherAccountId: teacherId,
    })
    expect(r.enqueued).toBe(false)
  })
})
