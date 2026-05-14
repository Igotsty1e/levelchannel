import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { GET as conflictsHandler } from '@/app/api/teacher/slots/[id]/conflicts/route'
import { POST as deleteExternalHandler } from '@/app/api/teacher/slots/[id]/delete-external-conflict/route'
import { POST as dismissHandler } from '@/app/api/teacher/slots/[id]/dismiss-conflict/route'
import { POST as loginHandler } from '@/app/api/auth/login/route'
import { POST as registerHandler } from '@/app/api/auth/register/route'
import {
  getAccountByEmail,
  grantAccountRole,
  markAccountVerified,
} from '@/lib/auth/accounts'
import { upsertAccountProfile } from '@/lib/auth/profiles'
import { __resetCalendarEncryptionKeyCache } from '@/lib/calendar/encryption'
import { __resetGoogleCalendarOauthConfigCache } from '@/lib/calendar/google/config'
import { upsertGoogleIntegration } from '@/lib/calendar/integrations'
import { getDbPool } from '@/lib/db/pool'

import '../setup'
import { buildRequest, extractSessionCookie } from '../helpers'

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
  process.env.GOOGLE_CALENDAR_CLIENT_SECRET = 'cs'
  process.env.GOOGLE_CALENDAR_REDIRECT_URL = 'https://lc.test/api/teacher/calendar/google/callback'
  process.env.GOOGLE_OAUTH_STATE_SECRET = 's'.repeat(40)
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

async function teacherCookieAndId(
  email: string,
): Promise<{ cookie: string; accountId: string }> {
  const password = 'StrongPassword123'
  await registerHandler(
    buildRequest('/api/auth/register', {
      body: { email, password, personalDataConsentAccepted: true },
    }),
  )
  const acc = await getAccountByEmail(email)
  await markAccountVerified(acc!.id)
  await grantAccountRole(acc!.id, 'teacher', null)
  await upsertAccountProfile(acc!.id, {
    displayName: 'T',
    timezone: 'Europe/Moscow',
    locale: 'ru',
  })
  const login = await loginHandler(
    buildRequest('/api/auth/login', { body: { email, password } }),
  )
  return {
    cookie: extractSessionCookie(login.headers.get('Set-Cookie'))!,
    accountId: acc!.id,
  }
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

async function makeConflictedSlot(opts: {
  teacherId: string
  startIso: string
  calId?: string
  eventId?: string
  isWritable?: boolean
}): Promise<string> {
  const pool = getDbPool()
  const slotR = await pool.query(
    `insert into lesson_slots (id, teacher_account_id, start_at, duration_minutes,
                                status, learner_account_id, booked_at,
                                external_conflict_at, external_conflict_kind,
                                conflict_source_calendar_id, conflict_source_event_id)
     values (gen_random_uuid(), $1, $2::timestamptz, 60, 'booked', $1, now(),
             now(), 'post_book_overlap', $3, $4)
     returning id`,
    [
      opts.teacherId,
      opts.startIso,
      opts.calId ?? 'primary',
      opts.eventId ?? 'evt-c',
    ],
  )
  const slotId = String(slotR.rows[0].id)
  await pool.query(
    `insert into teacher_external_busy_intervals (id, teacher_account_id,
       external_calendar_id, external_event_id, start_at, end_at,
       is_writable_in_source, fetched_at)
     values (gen_random_uuid(), $1, $2, $3, $4::timestamptz, $5::timestamptz,
             $6, now())`,
    [
      opts.teacherId,
      opts.calId ?? 'primary',
      opts.eventId ?? 'evt-c',
      opts.startIso,
      new Date(new Date(opts.startIso).getTime() + 60 * 60_000).toISOString(),
      opts.isWritable ?? true,
    ],
  )
  return slotId
}

describe('GET /api/teacher/slots/[id]/conflicts', () => {
  it('lists overlaps for the owning teacher', async () => {
    const t = await teacherCookieAndId('cf-list@example.com')
    const slot = await makeConflictedSlot({
      teacherId: t.accountId,
      startIso: '2026-12-01T10:00:00Z',
    })
    const res = await conflictsHandler(
      buildRequest(`/api/teacher/slots/${slot}/conflicts`, {
        cookie: t.cookie,
      }),
      { params: Promise.resolve({ id: slot }) },
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.overlaps).toHaveLength(1)
    expect(json.overlaps[0].externalEventId).toBe('evt-c')
  })

  it('returns 404 for foreign slot (no enumeration)', async () => {
    const tA = await teacherCookieAndId('cf-owner@example.com')
    const tB = await teacherCookieAndId('cf-foreign@example.com')
    const slot = await makeConflictedSlot({
      teacherId: tA.accountId,
      startIso: '2026-12-02T10:00:00Z',
    })
    const res = await conflictsHandler(
      buildRequest(`/api/teacher/slots/${slot}/conflicts`, {
        cookie: tB.cookie,
      }),
      { params: Promise.resolve({ id: slot }) },
    )
    expect(res.status).toBe(404)
  })
})

describe('POST /api/teacher/slots/[id]/dismiss-conflict', () => {
  it('clears conflict stamp on owned slot', async () => {
    const t = await teacherCookieAndId('cf-dis@example.com')
    const slot = await makeConflictedSlot({
      teacherId: t.accountId,
      startIso: '2026-12-03T10:00:00Z',
    })
    const res = await dismissHandler(
      buildRequest(`/api/teacher/slots/${slot}/dismiss-conflict`, {
        cookie: t.cookie,
        body: {},
      }),
      { params: Promise.resolve({ id: slot }) },
    )
    expect(res.status).toBe(200)
    const row = await getDbPool().query(
      'select external_conflict_at from lesson_slots where id = $1',
      [slot],
    )
    expect(row.rows[0].external_conflict_at).toBeNull()
  })

  it('returns 404 for foreign slot', async () => {
    const tA = await teacherCookieAndId('cf-dis-own@example.com')
    const tB = await teacherCookieAndId('cf-dis-foreign@example.com')
    const slot = await makeConflictedSlot({
      teacherId: tA.accountId,
      startIso: '2026-12-04T10:00:00Z',
    })
    const res = await dismissHandler(
      buildRequest(`/api/teacher/slots/${slot}/dismiss-conflict`, {
        cookie: tB.cookie,
        body: {},
      }),
      { params: Promise.resolve({ id: slot }) },
    )
    expect(res.status).toBe(404)
  })

  it('returns 404 when no conflict stamp present', async () => {
    const t = await teacherCookieAndId('cf-dis-clean@example.com')
    const pool = getDbPool()
    const slotR = await pool.query(
      `insert into lesson_slots (id, teacher_account_id, start_at, duration_minutes,
                                  status, learner_account_id, booked_at)
       values (gen_random_uuid(), $1, $2::timestamptz, 60, 'booked', $1, now())
       returning id`,
      [t.accountId, '2026-12-05T10:00:00Z'],
    )
    const slot = String(slotR.rows[0].id)
    const res = await dismissHandler(
      buildRequest(`/api/teacher/slots/${slot}/dismiss-conflict`, {
        cookie: t.cookie,
        body: {},
      }),
      { params: Promise.resolve({ id: slot }) },
    )
    expect(res.status).toBe(404)
  })
})

describe('POST /api/teacher/slots/[id]/delete-external-conflict', () => {
  it('deletes Google event + clears conflict on writable source', async () => {
    const t = await teacherCookieAndId('cf-del-ok@example.com')
    await connect(t.accountId)
    const slot = await makeConflictedSlot({
      teacherId: t.accountId,
      startIso: '2026-12-06T10:00:00Z',
      isWritable: true,
    })
    vi.stubGlobal('fetch', vi.fn(async () => jsonResp('', 204)))
    const res = await deleteExternalHandler(
      buildRequest(`/api/teacher/slots/${slot}/delete-external-conflict`, {
        cookie: t.cookie,
        body: {},
      }),
      { params: Promise.resolve({ id: slot }) },
    )
    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.deletedInGoogle).toBe(true)

    const slotRow = await getDbPool().query(
      'select external_conflict_at from lesson_slots where id = $1',
      [slot],
    )
    expect(slotRow.rows[0].external_conflict_at).toBeNull()

    const busyRow = await getDbPool().query(
      `select count(*)::int as n from teacher_external_busy_intervals
        where teacher_account_id = $1`,
      [t.accountId],
    )
    expect(busyRow.rows[0].n).toBe(0)
  })

  it('refuses on read-only source calendar', async () => {
    const t = await teacherCookieAndId('cf-del-readonly@example.com')
    await connect(t.accountId)
    const slot = await makeConflictedSlot({
      teacherId: t.accountId,
      startIso: '2026-12-07T10:00:00Z',
      isWritable: false,
    })
    const res = await deleteExternalHandler(
      buildRequest(`/api/teacher/slots/${slot}/delete-external-conflict`, {
        cookie: t.cookie,
        body: {},
      }),
      { params: Promise.resolve({ id: slot }) },
    )
    expect(res.status).toBe(403)
  })

  it('clears stamp locally if busy interval already disappeared', async () => {
    const t = await teacherCookieAndId('cf-del-gone@example.com')
    await connect(t.accountId)
    const slot = await makeConflictedSlot({
      teacherId: t.accountId,
      startIso: '2026-12-08T10:00:00Z',
    })
    // Drop the busy row underneath us.
    await getDbPool().query(
      `delete from teacher_external_busy_intervals where teacher_account_id = $1`,
      [t.accountId],
    )
    const res = await deleteExternalHandler(
      buildRequest(`/api/teacher/slots/${slot}/delete-external-conflict`, {
        cookie: t.cookie,
        body: {},
      }),
      { params: Promise.resolve({ id: slot }) },
    )
    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.action).toBe('cleared_locally')
    expect(j.deletedInGoogle).toBe(false)
  })

  it('returns 404 for foreign slot', async () => {
    const tA = await teacherCookieAndId('cf-del-own@example.com')
    const tB = await teacherCookieAndId('cf-del-foreign@example.com')
    const slot = await makeConflictedSlot({
      teacherId: tA.accountId,
      startIso: '2026-12-09T10:00:00Z',
    })
    const res = await deleteExternalHandler(
      buildRequest(`/api/teacher/slots/${slot}/delete-external-conflict`, {
        cookie: tB.cookie,
        body: {},
      }),
      { params: Promise.resolve({ id: slot }) },
    )
    expect(res.status).toBe(404)
  })

  it('returns 404 on hostile non-uuid slot id (no 500)', async () => {
    const t = await teacherCookieAndId('cf-del-baduuid@example.com')
    const res = await deleteExternalHandler(
      buildRequest(`/api/teacher/slots/not-a-uuid/delete-external-conflict`, {
        cookie: t.cookie,
        body: {},
      }),
      { params: Promise.resolve({ id: 'not-a-uuid' }) },
    )
    expect(res.status).toBe(404)
  })

  it('clears ALL slots bound to the same (cal_id, event_id) — plan §4.7', async () => {
    const t = await teacherCookieAndId('cf-del-multi@example.com')
    await connect(t.accountId)
    // Two booked slots that both got stamped with the same foreign
    // event (e.g. an all-day or long meeting covering both).
    const slotA = await makeConflictedSlot({
      teacherId: t.accountId,
      startIso: '2026-12-10T10:00:00Z',
      calId: 'primary',
      eventId: 'evt-shared',
      isWritable: true,
    })
    // Make a second slot stamped with the same conflict source. We
    // reuse the same calendar + event id deliberately.
    const slotBR = await getDbPool().query(
      `insert into lesson_slots (id, teacher_account_id, start_at, duration_minutes,
                                  status, learner_account_id, booked_at,
                                  external_conflict_at, external_conflict_kind,
                                  conflict_source_calendar_id, conflict_source_event_id)
       values (gen_random_uuid(), $1, $2::timestamptz, 60, 'booked', $1, now(),
               now(), 'post_book_overlap', 'primary', 'evt-shared')
       returning id`,
      [t.accountId, '2026-12-10T11:00:00Z'],
    )
    const slotB = String(slotBR.rows[0].id)

    vi.stubGlobal('fetch', vi.fn(async () => jsonResp('', 204)))
    const res = await deleteExternalHandler(
      buildRequest(`/api/teacher/slots/${slotA}/delete-external-conflict`, {
        cookie: t.cookie,
        body: {},
      }),
      { params: Promise.resolve({ id: slotA }) },
    )
    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.deletedInGoogle).toBe(true)
    expect(j.clearedSlots).toBe(2)

    const both = await getDbPool().query(
      'select id, external_conflict_at from lesson_slots where id = any($1::uuid[]) order by id',
      [[slotA, slotB]],
    )
    expect(both.rows).toHaveLength(2)
    for (const row of both.rows) {
      expect(row.external_conflict_at).toBeNull()
    }
  })

  // BCS-OP-ROLLOUT plan §4.6 / Codex round-3 WARN #5 — route-level
  // 401-retry regression. The wrapped deleteEvent call must
  // force-refresh on first 401, retry, and succeed.
  it('first Google 401 then 204 → route succeeds via withTokenRetry refresh', async () => {
    const t = await teacherCookieAndId('cf-del-401-retry@example.com')
    await connect(t.accountId)
    const slot = await makeConflictedSlot({
      teacherId: t.accountId,
      startIso: '2026-12-12T10:00:00Z',
      isWritable: true,
    })

    let deleteCallCount = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: RequestInfo | URL) => {
        const u = String(url)
        if (u.includes('oauth2.googleapis.com/token')) {
          // Token refresh succeeds (used by withTokenRetry's force-refresh).
          return jsonResp(
            {
              access_token: 'NEW_AT',
              expires_in: 3600,
              token_type: 'Bearer',
              scope: 's',
            },
            200,
          )
        }
        if (u.includes('/calendars/') && u.includes('/events/')) {
          deleteCallCount++
          if (deleteCallCount === 1) {
            return jsonResp('unauthorized', 401)
          }
          return jsonResp('', 204)
        }
        return jsonResp('not stubbed', 500)
      }),
    )

    const res = await deleteExternalHandler(
      buildRequest(`/api/teacher/slots/${slot}/delete-external-conflict`, {
        cookie: t.cookie,
        body: {},
      }),
      { params: Promise.resolve({ id: slot }) },
    )
    expect(res.status).toBe(200)
    expect(deleteCallCount).toBe(2)
    const j = await res.json()
    expect(j.deletedInGoogle).toBe(true)
  })

  // Two consecutive Google 401s → integration flipped to disconnected,
  // route surfaces a clean error.
  it('two consecutive 401s → integration disconnected, route returns failure', async () => {
    const t = await teacherCookieAndId('cf-del-double401@example.com')
    await connect(t.accountId)
    const slot = await makeConflictedSlot({
      teacherId: t.accountId,
      startIso: '2026-12-13T10:00:00Z',
      isWritable: true,
    })

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: RequestInfo | URL) => {
        const u = String(url)
        if (u.includes('oauth2.googleapis.com/token')) {
          return jsonResp(
            {
              access_token: 'NEW_AT',
              expires_in: 3600,
              token_type: 'Bearer',
              scope: 's',
            },
            200,
          )
        }
        if (u.includes('/calendars/') && u.includes('/events/')) {
          return jsonResp('unauthorized', 401)
        }
        return jsonResp('not stubbed', 500)
      }),
    )

    const res = await deleteExternalHandler(
      buildRequest(`/api/teacher/slots/${slot}/delete-external-conflict`, {
        cookie: t.cookie,
        body: {},
      }),
      { params: Promise.resolve({ id: slot }) },
    )
    expect(res.status).toBe(502)
    const j = await res.json()
    expect(j.error).toBe('google_delete_failed')

    // Integration MUST be flipped to disconnected per plan §4.11.
    const r = await getDbPool().query(
      `select sync_state from teacher_calendar_integrations where account_id = $1`,
      [t.accountId],
    )
    expect(r.rows[0].sync_state).toBe('disconnected')
  })

  it('enqueues priority-2 pull job after successful Google delete — plan §4.7', async () => {
    const t = await teacherCookieAndId('cf-del-pull-enq@example.com')
    await connect(t.accountId)
    const slot = await makeConflictedSlot({
      teacherId: t.accountId,
      startIso: '2026-12-11T10:00:00Z',
      isWritable: true,
    })
    vi.stubGlobal('fetch', vi.fn(async () => jsonResp('', 204)))
    const res = await deleteExternalHandler(
      buildRequest(`/api/teacher/slots/${slot}/delete-external-conflict`, {
        cookie: t.cookie,
        body: {},
      }),
      { params: Promise.resolve({ id: slot }) },
    )
    expect(res.status).toBe(200)
    const pullJob = await getDbPool().query(
      `select priority, status from calendar_pull_jobs
        where teacher_account_id = $1 and external_calendar_id = 'primary'`,
      [t.accountId],
    )
    expect(pullJob.rows).toHaveLength(1)
    expect(Number(pullJob.rows[0].priority)).toBe(2)
    expect(pullJob.rows[0].status).toBe('pending')
  })
})

describe('POST /api/teacher/slots/[id]/dismiss-conflict — UUID guard', () => {
  it('returns 404 on hostile non-uuid id (no 500)', async () => {
    const t = await teacherCookieAndId('cf-dis-baduuid@example.com')
    const res = await dismissHandler(
      buildRequest(`/api/teacher/slots/not-a-uuid/dismiss-conflict`, {
        cookie: t.cookie,
        body: {},
      }),
      { params: Promise.resolve({ id: 'not-a-uuid' }) },
    )
    expect(res.status).toBe(404)
  })
})
