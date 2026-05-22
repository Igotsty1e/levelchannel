import { describe, expect, it } from 'vitest'

import { POST as bookHandler } from '@/app/api/slots/[id]/book/route'
import { POST as adminCreateHandler } from '@/app/api/admin/slots/route'
import { POST as loginHandler } from '@/app/api/auth/login/route'
import { POST as registerHandler } from '@/app/api/auth/register/route'
import {
  getAccountByEmail,
  grantAccountRole,
  markAccountVerified,
} from '@/lib/auth/accounts'
import { upsertAccountProfile } from '@/lib/auth/profiles'
import { __resetCalendarEncryptionKeyCache } from '@/lib/calendar/encryption'
import { upsertGoogleIntegration } from '@/lib/calendar/integrations'
import { getDbPool } from '@/lib/db/pool'

import '../setup'
import {
  buildRequest,
  extractSessionCookie,
  futureSlotIso as futureIsoMinutes,
} from '../helpers'

// BCS-D.5 — P0 atomic overlap check inside bookSlot. Plan §4.2 F3
// freshness contract: busy-cache rejects a booking ONLY when the
// teacher's integration is `active` AND `last_pulled_at` is within
// the TTL (10 minutes). On degraded / stale / disconnected — the
// cache is IGNORED.

const TEST_KEY = 'k'.repeat(48)

async function setEncryptionKeyForTest() {
  process.env.CALENDAR_ENCRYPTION_KEY = TEST_KEY
  __resetCalendarEncryptionKeyCache()
}

async function registerAndCookie(
  email: string,
  opts: { verifyEmail?: boolean; role?: 'admin' | 'teacher' } = {},
): Promise<{ cookie: string; accountId: string }> {
  const password = 'StrongPassword123'
  const reg = await registerHandler(
    buildRequest('/api/auth/register', {
      body: { email, password, personalDataConsentAccepted: true },
    }),
  )
  expect(reg.status).toBe(200)
  const created = await getAccountByEmail(email)
  expect(created).not.toBeNull()
  if (opts.verifyEmail) {
    await markAccountVerified(created!.id)
  }
  if (opts.role) {
    await grantAccountRole(created!.id, opts.role, null)
  }
  const login = await loginHandler(
    buildRequest('/api/auth/login', { body: { email, password } }),
  )
  expect(login.status).toBe(200)
  const cookie = extractSessionCookie(login.headers.get('Set-Cookie'))
  expect(cookie).not.toBeNull()
  return { cookie: cookie!, accountId: created!.id }
}

// SAAS-PIVOT Day 2 (2026-05-22) — dual-write: see book-agenda.test.ts.
async function assignTeacher(
  learnerAccountId: string,
  teacherAccountId: string,
): Promise<void> {
  const pool = getDbPool()
  await pool.query(
    `update accounts set assigned_teacher_id = $2 where id = $1`,
    [learnerAccountId, teacherAccountId],
  )
  await pool.query(
    `insert into learner_teacher_links (learner_account_id, teacher_account_id, linked_at)
       values ($1, $2, now())
     on conflict (learner_account_id, teacher_account_id) do update
       set unlinked_at = null`,
    [learnerAccountId, teacherAccountId],
  )
}

async function stampPullFresh(teacherAccountId: string): Promise<void> {
  await getDbPool().query(
    `update teacher_calendar_integrations
        set last_pulled_at = now()
      where account_id = $1`,
    [teacherAccountId],
  )
}

async function setSyncStateAndPull(
  teacherAccountId: string,
  state: 'active' | 'degraded',
  lastPulledAt: 'fresh' | 'stale' | 'null',
): Promise<void> {
  const pulled =
    lastPulledAt === 'fresh'
      ? 'now()'
      : lastPulledAt === 'stale'
        ? "now() - interval '20 minutes'"
        : 'null'
  await getDbPool().query(
    `update teacher_calendar_integrations
        set sync_state = $2, last_pulled_at = ${pulled}
      where account_id = $1`,
    [teacherAccountId, state],
  )
}

async function setupTeacherWithSlot(suffix: string): Promise<{
  teacherId: string
  slotId: string
  startAt: string
  durationMinutes: number
  learner: { cookie: string; accountId: string }
}> {
  await setEncryptionKeyForTest()

  const teacher = await registerAndCookie(`teacher-d5-${suffix}@example.com`, {
    verifyEmail: true,
    role: 'teacher',
  })
  // Teacher needs MSK timezone for the integration trigger to allow active state.
  await upsertAccountProfile(teacher.accountId, {
    displayName: 'T',
    timezone: 'Europe/Moscow',
    locale: 'ru',
  })

  const admin = await registerAndCookie(`admin-d5-${suffix}@example.com`, {
    verifyEmail: true,
    role: 'admin',
  })
  const learner = await registerAndCookie(`learner-d5-${suffix}@example.com`, {
    verifyEmail: true,
  })
  await assignTeacher(learner.accountId, teacher.accountId)

  const startAt = futureIsoMinutes(60)
  const created = await adminCreateHandler(
    buildRequest('/api/admin/slots', {
      cookie: admin.cookie,
      body: {
        teacherAccountId: teacher.accountId,
        startAt,
        durationMinutes: 60,
      },
    }),
  )
  const slotId = (await created.json()).slot.id as string

  return {
    teacherId: teacher.accountId,
    slotId,
    startAt,
    durationMinutes: 60,
    learner,
  }
}

async function insertBusyInterval(
  teacherAccountId: string,
  startAt: string,
  endAtIso: string,
  is_own_event = false,
): Promise<void> {
  await getDbPool().query(
    `insert into teacher_external_busy_intervals
       (id, teacher_account_id, external_calendar_id, external_event_id,
        start_at, end_at, is_own_event, is_writable_in_source, fetched_at)
     values (
       gen_random_uuid(), $1, 'primary', 'evt-' || gen_random_uuid()::text,
       $2::timestamptz, $3::timestamptz, $4, true, now()
     )`,
    [teacherAccountId, startAt, endAtIso, is_own_event],
  )
}

async function connectActiveIntegration(teacherId: string): Promise<void> {
  const r = await upsertGoogleIntegration({
    accountId: teacherId,
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

describe('BCS-D.5 — atomic busy-overlap gate in bookSlot', () => {
  it('no integration → busy gate is silent, slot books normally', async () => {
    const { slotId, learner } = await setupTeacherWithSlot('noint')
    const res = await bookHandler(
      buildRequest(`/api/slots/${slotId}/book`, {
        cookie: learner.cookie,
        body: {},
      }),
      { params: Promise.resolve({ id: slotId }) },
    )
    expect(res.status).toBe(200)
  })

  it('integration active + fresh pull + overlapping busy → 409 external_conflict', async () => {
    const setup = await setupTeacherWithSlot('blocked')
    await connectActiveIntegration(setup.teacherId)
    await stampPullFresh(setup.teacherId)
    // Insert busy interval covering the slot's full duration.
    const slotStartIso = new Date(setup.startAt).toISOString()
    const slotEndIso = new Date(
      new Date(setup.startAt).getTime() + setup.durationMinutes * 60_000,
    ).toISOString()
    await insertBusyInterval(setup.teacherId, slotStartIso, slotEndIso)

    const res = await bookHandler(
      buildRequest(`/api/slots/${setup.slotId}/book`, {
        cookie: setup.learner.cookie,
        body: {},
      }),
      { params: Promise.resolve({ id: setup.slotId }) },
    )
    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.error).toBe('external_conflict')

    // Slot remained open.
    const pool = getDbPool()
    const r = await pool.query(
      'select status from lesson_slots where id = $1',
      [setup.slotId],
    )
    expect(r.rows[0].status).toBe('open')
  })

  it('integration active + fresh pull + non-overlapping busy → slot still books', async () => {
    const setup = await setupTeacherWithSlot('nonoverlap')
    await connectActiveIntegration(setup.teacherId)
    await stampPullFresh(setup.teacherId)
    // Busy interval ENDS before the slot starts.
    const slotStartIso = new Date(setup.startAt).toISOString()
    const busyEnd = new Date(
      new Date(setup.startAt).getTime() - 60 * 60_000,
    ).toISOString()
    const busyStart = new Date(
      new Date(setup.startAt).getTime() - 2 * 60 * 60_000,
    ).toISOString()
    await insertBusyInterval(setup.teacherId, busyStart, busyEnd)
    expect(slotStartIso).not.toBe(busyEnd)

    const res = await bookHandler(
      buildRequest(`/api/slots/${setup.slotId}/book`, {
        cookie: setup.learner.cookie,
        body: {},
      }),
      { params: Promise.resolve({ id: setup.slotId }) },
    )
    expect(res.status).toBe(200)
  })

  it('integration degraded + overlapping busy → cache ignored, slot books', async () => {
    const setup = await setupTeacherWithSlot('degraded')
    await connectActiveIntegration(setup.teacherId)
    // Flip to degraded — F3 contract says cache is ignored.
    await setSyncStateAndPull(setup.teacherId, 'degraded', 'fresh')
    const slotStartIso = new Date(setup.startAt).toISOString()
    const slotEndIso = new Date(
      new Date(setup.startAt).getTime() + setup.durationMinutes * 60_000,
    ).toISOString()
    await insertBusyInterval(setup.teacherId, slotStartIso, slotEndIso)

    const res = await bookHandler(
      buildRequest(`/api/slots/${setup.slotId}/book`, {
        cookie: setup.learner.cookie,
        body: {},
      }),
      { params: Promise.resolve({ id: setup.slotId }) },
    )
    expect(res.status).toBe(200)
  })

  it('integration active + stale pull (>10 min) → cache ignored, slot books', async () => {
    const setup = await setupTeacherWithSlot('stale')
    await connectActiveIntegration(setup.teacherId)
    await setSyncStateAndPull(setup.teacherId, 'active', 'stale')
    const slotStartIso = new Date(setup.startAt).toISOString()
    const slotEndIso = new Date(
      new Date(setup.startAt).getTime() + setup.durationMinutes * 60_000,
    ).toISOString()
    await insertBusyInterval(setup.teacherId, slotStartIso, slotEndIso)

    const res = await bookHandler(
      buildRequest(`/api/slots/${setup.slotId}/book`, {
        cookie: setup.learner.cookie,
        body: {},
      }),
      { params: Promise.resolve({ id: setup.slotId }) },
    )
    expect(res.status).toBe(200)
  })

  it('is_own_event=true busy row is ignored (LC pushed its own event)', async () => {
    const setup = await setupTeacherWithSlot('ownevent')
    await connectActiveIntegration(setup.teacherId)
    await stampPullFresh(setup.teacherId)
    const slotStartIso = new Date(setup.startAt).toISOString()
    const slotEndIso = new Date(
      new Date(setup.startAt).getTime() + setup.durationMinutes * 60_000,
    ).toISOString()
    // This represents our own push showing up in pull — must NOT block.
    await insertBusyInterval(setup.teacherId, slotStartIso, slotEndIso, true)

    const res = await bookHandler(
      buildRequest(`/api/slots/${setup.slotId}/book`, {
        cookie: setup.learner.cookie,
        body: {},
      }),
      { params: Promise.resolve({ id: setup.slotId }) },
    )
    expect(res.status).toBe(200)
  })

  it('partial overlap (busy interval covers only the slot\'s first 5 minutes) still blocks', async () => {
    const setup = await setupTeacherWithSlot('partial')
    await connectActiveIntegration(setup.teacherId)
    await stampPullFresh(setup.teacherId)
    const slotStartIso = new Date(setup.startAt).toISOString()
    const partialEnd = new Date(
      new Date(setup.startAt).getTime() + 5 * 60_000,
    ).toISOString()
    await insertBusyInterval(setup.teacherId, slotStartIso, partialEnd)

    const res = await bookHandler(
      buildRequest(`/api/slots/${setup.slotId}/book`, {
        cookie: setup.learner.cookie,
        body: {},
      }),
      { params: Promise.resolve({ id: setup.slotId }) },
    )
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('external_conflict')
  })
})
