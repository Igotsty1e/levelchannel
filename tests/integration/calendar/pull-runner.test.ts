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

// BCS-DEF-7 Phase 2 (2026-05-19) — delta path integration coverage.
//
// Hermetic: every test mocks `fetch` via vi.stubGlobal. Covers the
// plan §3.2 cases:
//   - first call with token=NULL active teacher → full mode, captures nextSyncToken
//   - second call with token set → delta mode; cancelled item deletes; new item upserts
//   - 410 from delta → next_sync_token cleared, last_error='sync_token_expired'
//   - concurrent delta race: optimistic guard rejects the second writer
//   - inactive teacher predicate: token present but cold → falls back to full-rewrite
//   - reconnect-mid-flight race: rotating epoch under us makes the UPDATE rowcount=0
//   - reconnect-clear hook: initial_connect upsert nulls next_sync_token
function mockEventsListWithSyncToken(
  items: unknown[],
  nextSyncToken: string | null,
): Response {
  const payload: Record<string, unknown> = { items }
  if (nextSyncToken !== null) payload.nextSyncToken = nextSyncToken
  return {
    ok: true,
    status: 200,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  } as unknown as Response
}

async function bookSlot(
  teacherAccountId: string,
  learnerAccountId: string,
  startAt: string,
): Promise<string> {
  const pool = getDbPool()
  const r = await pool.query(
    `insert into lesson_slots (
       id, teacher_account_id, start_at, duration_minutes, status,
       learner_account_id, booked_at
     ) values (
       gen_random_uuid(), $1, $2::timestamptz, 60, 'booked', $3, now()
     ) returning id`,
    [teacherAccountId, startAt, learnerAccountId],
  )
  return String(r.rows[0].id)
}

describe('runPullForCalendar — delta path (BCS-DEF-7 Phase 2)', () => {
  it('first call (token=NULL, active teacher): runs full mode + captures nextSyncToken', async () => {
    const teacherId = await makeTeacher('teacher-pull-delta-1@example.com')
    const learnerId = await makeTeacher('learner-pull-delta-1@example.com')
    await connect(teacherId)
    // Make teacher "active" via a recent booked slot (24h gate
    // would also work, but lastPulledAt is NULL here on fresh connect).
    await bookSlot(teacherId, learnerId, '2027-01-01T09:00:00Z')

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: RequestInfo | URL) => {
        const u = String(url)
        // First call must be full-rewrite (no syncToken in URL).
        expect(u).not.toContain('syncToken=')
        return mockEventsListWithSyncToken(
          [
            {
              id: 'EVT_INIT',
              summary: 'Init',
              start: { dateTime: '2026-06-01T09:00:00Z' },
              end: { dateTime: '2026-06-01T10:00:00Z' },
            },
          ],
          'FIRST_TOKEN',
        )
      }),
    )
    const r = await runPullForCalendar({
      teacherAccountId: teacherId,
      externalCalendarId: 'primary',
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.mode).toBe('full')
      expect(r.intervalsAfter).toBe(1)
    }
    const meta = await getGoogleIntegrationMeta(teacherId)
    expect(meta?.nextSyncToken).toBe('FIRST_TOKEN')
  })

  it('second call (token set, active teacher): delta mode; cancelled deletes a cached row, new upserts, token updates', async () => {
    const teacherId = await makeTeacher('teacher-pull-delta-2@example.com')
    const learnerId = await makeTeacher('learner-pull-delta-2@example.com')
    await connect(teacherId)
    await bookSlot(teacherId, learnerId, '2027-01-01T09:00:00Z')
    const pool = getDbPool()

    // Seed an existing busy interval that the upcoming delta will cancel.
    await pool.query(
      `insert into teacher_external_busy_intervals
         (id, teacher_account_id, external_calendar_id, external_event_id,
          start_at, end_at, fetched_at)
       values (
         gen_random_uuid(), $1, 'primary', 'WILL_CANCEL',
         now() + interval '1 day', now() + interval '1 day' + interval '30 min',
         now()
       )`,
      [teacherId],
    )
    // Seed the token so the next pull runs in delta mode.
    await pool.query(
      `update teacher_calendar_integrations
          set next_sync_token = 'TOKEN_V1', last_pulled_at = now()
        where account_id = $1`,
      [teacherId],
    )

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: RequestInfo | URL) => {
        const u = String(url)
        expect(u).toContain('syncToken=TOKEN_V1')
        expect(u).toContain('showDeleted=true')
        return mockEventsListWithSyncToken(
          [
            { id: 'WILL_CANCEL', status: 'cancelled' },
            {
              id: 'NEW_EVT',
              summary: 'New',
              start: { dateTime: '2026-06-05T09:00:00Z' },
              end: { dateTime: '2026-06-05T10:00:00Z' },
            },
          ],
          'TOKEN_V2',
        )
      }),
    )
    const r = await runPullForCalendar({
      teacherAccountId: teacherId,
      externalCalendarId: 'primary',
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.mode).toBe('delta')
      expect(r.cancelledEvents).toBe(1)
      expect(r.deltaTokenRefreshed).toBe(true)
    }
    // The cancelled row is gone; the new row landed.
    const rows = await pool.query(
      `select external_event_id from teacher_external_busy_intervals
        where teacher_account_id = $1 order by external_event_id`,
      [teacherId],
    )
    expect(rows.rows.map((r) => r.external_event_id)).toEqual(['NEW_EVT'])

    const meta = await getGoogleIntegrationMeta(teacherId)
    expect(meta?.nextSyncToken).toBe('TOKEN_V2')
  })

  it('410 Gone from delta clears next_sync_token + sets last_error=sync_token_expired', async () => {
    const teacherId = await makeTeacher('teacher-pull-delta-410@example.com')
    const learnerId = await makeTeacher('learner-pull-delta-410@example.com')
    await connect(teacherId)
    await bookSlot(teacherId, learnerId, '2027-01-01T09:00:00Z')
    const pool = getDbPool()
    await pool.query(
      `update teacher_calendar_integrations
          set next_sync_token = 'EXPIRED_TOKEN', last_pulled_at = now()
        where account_id = $1`,
      [teacherId],
    )

    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          ({
            ok: false,
            status: 410,
            json: async () => ({}),
            text: async () => 'Sync token expired',
          }) as unknown as Response,
      ),
    )
    const r = await runPullForCalendar({
      teacherAccountId: teacherId,
      externalCalendarId: 'primary',
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.kind).toBe('sync_token_expired')

    const meta = await pool.query(
      `select next_sync_token, last_error
         from teacher_calendar_integrations where account_id = $1`,
      [teacherId],
    )
    expect(meta.rows[0].next_sync_token).toBeNull()
    expect(meta.rows[0].last_error).toBe('sync_token_expired')
  })

  it('inactive-teacher predicate: token set BUT no recent bookings AND last_pulled_at > 24h ago → falls back to full-rewrite', async () => {
    const teacherId = await makeTeacher('teacher-pull-cold@example.com')
    await connect(teacherId)
    const pool = getDbPool()
    // Token present but the teacher is cold: no booked future slots,
    // last pulled 48h ago.
    await pool.query(
      `update teacher_calendar_integrations
          set next_sync_token = 'COLD_TOKEN',
              last_pulled_at = now() - interval '48 hours'
        where account_id = $1`,
      [teacherId],
    )

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: RequestInfo | URL) => {
        const u = String(url)
        expect(u).not.toContain('syncToken=')
        return mockEventsListWithSyncToken([], 'COLD_FRESH_TOKEN')
      }),
    )
    const r = await runPullForCalendar({
      teacherAccountId: teacherId,
      externalCalendarId: 'primary',
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.mode).toBe('full')
  })

  it('reconnect mid-flight: rotating epoch under an in-flight worker makes the optimistic guard fail (rowcount=0, TX rollback)', async () => {
    // Simulate: worker A reads (token=T1, epoch=E1) at the start;
    // before commit, the integration row's epoch rotates to E2 via
    // initial_connect (reconnect). The optimistic guard
    // `epoch = $startedEpoch` fails; the runner returns success
    // with intervalsAfter=0 (no-op) and the local busy-cache stays
    // untouched.
    //
    // We can't easily race two real pulls; instead we directly tamper
    // with the integration's epoch right before calling runPullForCalendar,
    // by stubbing fetch to first rotate the row, then return the response.
    const teacherId = await makeTeacher('teacher-pull-reconn-race@example.com')
    const learnerId = await makeTeacher('learner-pull-reconn-race@example.com')
    await connect(teacherId)
    await bookSlot(teacherId, learnerId, '2027-01-01T09:00:00Z')
    const pool = getDbPool()
    // Worker A's start-of-cycle state.
    await pool.query(
      `update teacher_calendar_integrations
          set next_sync_token = 'T_RACE', last_pulled_at = now()
        where account_id = $1`,
      [teacherId],
    )
    // Seed an existing busy row that delta would normally upsert
    // into. After the racing reconnect the optimistic guard must
    // fail and this row must remain untouched (rolled-back TX).
    await pool.query(
      `insert into teacher_external_busy_intervals
         (id, teacher_account_id, external_calendar_id, external_event_id,
          start_at, end_at, fetched_at)
       values (
         gen_random_uuid(), $1, 'primary', 'PRE_RACE',
         now() + interval '1 day', now() + interval '1 day' + interval '30 min',
         now()
       )`,
      [teacherId],
    )

    // First fetch call: race in a reconnect (rotates epoch) BEFORE
    // returning the delta response.
    let rotated = false
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        if (!rotated) {
          rotated = true
          await pool.query(
            `update teacher_calendar_integrations
                set epoch = gen_random_uuid()::text,
                    last_reconnected_at = now()
              where account_id = $1`,
            [teacherId],
          )
        }
        return mockEventsListWithSyncToken(
          [
            {
              id: 'PRE_RACE',
              summary: 'Updated by delta — should NOT land',
              start: { dateTime: '2026-06-10T09:00:00Z' },
              end: { dateTime: '2026-06-10T10:00:00Z' },
            },
          ],
          'T_RACE_NEW',
        )
      }),
    )

    const r = await runPullForCalendar({
      teacherAccountId: teacherId,
      externalCalendarId: 'primary',
    })
    // Guard miss: success but intervalsAfter=0 (no-op).
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.intervalsAfter).toBe(0)
    }
    // Token did NOT advance — the post-reconnect cycle owns the
    // next capture.
    const meta = await getGoogleIntegrationMeta(teacherId)
    expect(meta?.nextSyncToken).toBe('T_RACE')
    // PRE_RACE row was NOT updated (TX rolled back).
    const rows = await pool.query(
      `select external_event_id, start_at from teacher_external_busy_intervals
        where teacher_account_id = $1`,
      [teacherId],
    )
    expect(rows.rows).toHaveLength(1)
    expect(rows.rows[0].external_event_id).toBe('PRE_RACE')
    // start_at retained pre-race value (not the would-be delta value).
    const startAt = new Date(rows.rows[0].start_at).getTime()
    const wouldBe = new Date('2026-06-10T09:00:00Z').getTime()
    expect(startAt).not.toBe(wouldBe)
  })

  it('reconnect-clear hook (§0a BLOCKER#2 closure): initial_connect upsert clears next_sync_token to NULL', async () => {
    // Regression test sitting alongside the existing reconnect
    // freshness-case at integrations.test.ts:327. Asserts the hook
    // that makes Phase 2 safe: a teacher who reconnects MUST start
    // the next pull cycle with token=NULL, so the post-reconnect
    // full-rewrite repopulates the busy-cache under the new epoch
    // and seeds a fresh token, instead of running a delta against
    // a token that points at the pre-reconnect read_calendar_ids.
    const teacherId = await makeTeacher('teacher-reconn-clear@example.com')
    await connect(teacherId)
    const pool = getDbPool()
    // Simulate a prior successful delta cycle landing a token.
    await pool.query(
      `update teacher_calendar_integrations
          set next_sync_token = 'T_OLD'
        where account_id = $1`,
      [teacherId],
    )
    let mid = await getGoogleIntegrationMeta(teacherId)
    expect(mid?.nextSyncToken).toBe('T_OLD')

    // Reconnect (initial_connect upsert on an existing row).
    await upsertGoogleIntegration({
      accountId: teacherId,
      accessToken: 'AT2',
      refreshToken: 'RT2',
      scope: 's',
      tokenExpiresAt: new Date(Date.now() + 3600_000),
      readCalendarIds: ['primary'],
      writeCalendarId: 'primary',
      reason: 'initial_connect',
    })

    const after = await getGoogleIntegrationMeta(teacherId)
    expect(after?.nextSyncToken).toBeNull()
    // Sanity: the on-disk row also nulled (defends against a
    // rowToRecord mapping bug — the column itself must be NULL,
    // not just the JS field).
    const raw = await pool.query(
      `select next_sync_token from teacher_calendar_integrations
        where account_id = $1`,
      [teacherId],
    )
    expect(raw.rows[0].next_sync_token).toBeNull()
  })
})
