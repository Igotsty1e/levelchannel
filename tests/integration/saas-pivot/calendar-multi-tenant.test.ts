// SaaS-pivot multi-tenant audit (2026-05-23) — closing GAP-1 + asserting
// per-tenant isolation across the whole calendar contour.
//
// What this proves end-to-end:
//
//   1. Teacher A connecting Google Calendar persists ONE row in
//      `teacher_calendar_integrations(account_id=A)`. Teacher B's row
//      stays untouched.
//   2. A second teacher connects independently — their row appears
//      separately, no cross-tenant leak in either row's tokens, scope,
//      or epoch.
//   3. Pull-runner against `teacher_account_id=A` only writes rows
//      into `teacher_external_busy_intervals(teacher_account_id=A)`;
//      teacher B's intervals stay untouched.
//   4. Booking under teacher A enqueues a push job for A's calendar
//      only; teacher B's push queue stays empty.
//   5. Cancelling under teacher A enqueues a delete push for A's
//      calendar only.
//   6. Conflict-detector flags slots in A's calendar against A's
//      busy intervals; teacher B's slots are evaluated against B's
//      busy intervals only — no cross-tenant overlap detection.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createAccount,
  grantAccountRole,
  normalizeAccountEmail,
} from '@/lib/auth/accounts'
import { hashPassword } from '@/lib/auth/password'
import { upsertAccountProfile } from '@/lib/auth/profiles'
import { runConflictDetectionForTeacher } from '@/lib/calendar/conflict-detector'
import { __resetCalendarEncryptionKeyCache } from '@/lib/calendar/encryption'
import {
  getGoogleIntegration,
  getGoogleIntegrationMeta,
  upsertGoogleIntegration,
} from '@/lib/calendar/integrations'
import { runPullForCalendar } from '@/lib/calendar/pull-runner'
import {
  enqueueCreatePushIfIntegrationActive,
  enqueuePushJob,
} from '@/lib/calendar/push-worker'
import { getDbPool } from '@/lib/db/pool'

import '../setup'

const TEST_KEY = 'k'.repeat(48)

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
    displayName: email,
    timezone: 'Europe/Moscow',
    locale: 'ru',
  })
  return account.id
}

async function connect(
  accountId: string,
  opts: { accessToken: string; refreshToken: string } = {
    accessToken: 'AT',
    refreshToken: 'RT',
  },
): Promise<void> {
  const r = await upsertGoogleIntegration({
    accountId,
    accessToken: opts.accessToken,
    refreshToken: opts.refreshToken,
    scope: 'https://www.googleapis.com/auth/calendar.events',
    tokenExpiresAt: new Date(Date.now() + 3600_000),
    readCalendarIds: ['primary'],
    writeCalendarId: 'primary',
    reason: 'initial_connect',
  })
  expect(r.ok).toBe(true)
}

async function bookedSlot(
  teacherId: string,
  startIso: string,
  duration = 60,
): Promise<string> {
  const pool = getDbPool()
  const r = await pool.query(
    `insert into lesson_slots (id, teacher_account_id, start_at, duration_minutes,
                               status, learner_account_id, booked_at)
     values (gen_random_uuid(), $1, $2::timestamptz, $3, 'booked', $1, now())
     returning id`,
    [teacherId, startIso, duration],
  )
  return String(r.rows[0].id)
}

function mockEventsListResponse(items: unknown[]): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ items }),
    text: async () => JSON.stringify({ items }),
  } as unknown as Response
}

describe('saas-pivot/calendar-multi-tenant — per-teacher isolation', () => {
  it('teacher A connect creates exactly one row keyed by account_id; teacher B unaffected', async () => {
    const a = await makeTeacher('a-connect@example.com')
    const b = await makeTeacher('b-connect@example.com')
    await connect(a, { accessToken: 'A-access', refreshToken: 'A-refresh' })

    const pool = getDbPool()
    const r = await pool.query(
      `select count(*)::int as n from teacher_calendar_integrations`,
    )
    expect(Number(r.rows[0].n)).toBe(1)

    const metaA = await getGoogleIntegrationMeta(a)
    expect(metaA?.accountId).toBe(a)
    expect(metaA?.syncState).toBe('active')

    const metaB = await getGoogleIntegrationMeta(b)
    expect(metaB).toBeNull()
  })

  it('teacher B connect is independent — separate epoch, separate tokens, no cross-tenant leak', async () => {
    const a = await makeTeacher('a-iso@example.com')
    const b = await makeTeacher('b-iso@example.com')
    await connect(a, { accessToken: 'A-access', refreshToken: 'A-refresh' })
    await connect(b, { accessToken: 'B-access', refreshToken: 'B-refresh' })

    const fullA = await getGoogleIntegration(a)
    const fullB = await getGoogleIntegration(b)
    expect(fullA?.accessToken).toBe('A-access')
    expect(fullA?.refreshToken).toBe('A-refresh')
    expect(fullB?.accessToken).toBe('B-access')
    expect(fullB?.refreshToken).toBe('B-refresh')

    // Epoch rotates per-account on initial_connect; A's epoch MUST NOT
    // equal B's epoch (otherwise an ownership stamp from one teacher
    // could pose as the other's own_event).
    expect(fullA?.epoch).toBeTruthy()
    expect(fullB?.epoch).toBeTruthy()
    expect(fullA?.epoch).not.toBe(fullB?.epoch)
  })

  it('pull-runner for teacher A only writes A\'s busy intervals — B untouched', async () => {
    const a = await makeTeacher('a-pull@example.com')
    const b = await makeTeacher('b-pull@example.com')
    await connect(a)
    await connect(b)

    // Stub Google events.list — single foreign busy event.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        mockEventsListResponse([
          {
            id: 'EVT-A1',
            status: 'confirmed',
            start: { dateTime: '2026-10-15T10:00:00Z' },
            end: { dateTime: '2026-10-15T11:00:00Z' },
            summary: 'foreign',
            etag: '"e"',
          },
        ]),
      ),
    )

    const out = await runPullForCalendar({
      teacherAccountId: a,
      externalCalendarId: 'primary',
    })
    expect(out.ok).toBe(true)

    const pool = getDbPool()
    const aRows = await pool.query(
      `select count(*)::int as n from teacher_external_busy_intervals
        where teacher_account_id = $1`,
      [a],
    )
    expect(Number(aRows.rows[0].n)).toBe(1)

    const bRows = await pool.query(
      `select count(*)::int as n from teacher_external_busy_intervals
        where teacher_account_id = $1`,
      [b],
    )
    expect(Number(bRows.rows[0].n)).toBe(0)
  })

  it('booking under teacher A enqueues a create push for A only — B\'s push queue stays empty', async () => {
    const a = await makeTeacher('a-book@example.com')
    const b = await makeTeacher('b-book@example.com')
    await connect(a)
    await connect(b)

    const slotA = await bookedSlot(a, '2026-10-20T10:00:00Z')
    const enq = await enqueueCreatePushIfIntegrationActive({
      slotId: slotA,
      teacherAccountId: a,
    })
    expect(enq.enqueued).toBe(true)

    const pool = getDbPool()
    const aJobs = await pool.query(
      `select kind, slot_id, teacher_account_id
         from calendar_push_jobs
        where teacher_account_id = $1`,
      [a],
    )
    expect(aJobs.rows.length).toBe(1)
    expect(aJobs.rows[0].kind).toBe('create')
    expect(String(aJobs.rows[0].slot_id)).toBe(slotA)

    const bJobs = await pool.query(
      `select count(*)::int as n from calendar_push_jobs
        where teacher_account_id = $1`,
      [b],
    )
    expect(Number(bJobs.rows[0].n)).toBe(0)
  })

  it('cancel-side enqueue (delete) on teacher A only touches A\'s push queue', async () => {
    const a = await makeTeacher('a-cancel@example.com')
    const b = await makeTeacher('b-cancel@example.com')
    await connect(a)
    await connect(b)

    const slotA = await bookedSlot(a, '2026-10-21T10:00:00Z')
    // Pretend a prior push bound the event.
    const pool = getDbPool()
    await pool.query(
      `update lesson_slots
          set external_event_id = 'EVT-A-DELETE',
              external_calendar_id = 'primary'
        where id = $1`,
      [slotA],
    )
    await enqueuePushJob({
      slotId: slotA,
      teacherAccountId: a,
      kind: 'delete',
      payload: { write_calendar_id: 'primary' },
    })

    const aDel = await pool.query(
      `select kind from calendar_push_jobs
        where teacher_account_id = $1 and kind = 'delete'`,
      [a],
    )
    expect(aDel.rows.length).toBe(1)

    const bDel = await pool.query(
      `select count(*)::int as n from calendar_push_jobs
        where teacher_account_id = $1`,
      [b],
    )
    expect(Number(bDel.rows[0].n)).toBe(0)
  })

  it('conflict-detector flags A\'s slots against A\'s busy intervals only; B\'s slots evaluated independently', async () => {
    const a = await makeTeacher('a-conflict@example.com')
    const b = await makeTeacher('b-conflict@example.com')
    await connect(a)
    await connect(b)

    const pool = getDbPool()
    // Slot for A overlapping a foreign event in A's calendar.
    const startAtA = new Date(Date.now() + 24 * 3600_000).toISOString()
    const slotA = await bookedSlot(a, startAtA)
    await pool.query(
      `insert into teacher_external_busy_intervals
         (id, teacher_account_id, external_calendar_id, external_event_id,
          start_at, end_at, is_own_event, is_orphan_self, fetched_at)
       values (gen_random_uuid(), $1, 'primary', 'EVT-A-FOREIGN',
               $2::timestamptz, $2::timestamptz + interval '60 minutes',
               false, false, now())`,
      [a, startAtA],
    )

    // Slot for B with NO overlap in B's own calendar.
    const startAtB = new Date(Date.now() + 24 * 3600_000 + 60_000).toISOString()
    const slotB = await bookedSlot(b, startAtB)

    // Crucially: also stamp a foreign event under B's calendar covering
    // a DIFFERENT time, plus a foreign event under A's calendar covering
    // B's start (cross-tenant noise). Neither should affect the other.
    await pool.query(
      `insert into teacher_external_busy_intervals
         (id, teacher_account_id, external_calendar_id, external_event_id,
          start_at, end_at, is_own_event, is_orphan_self, fetched_at)
       values
         (gen_random_uuid(), $1, 'primary', 'EVT-A-NOISE',
          $2::timestamptz, $2::timestamptz + interval '60 minutes',
          false, false, now()),
         (gen_random_uuid(), $3, 'primary', 'EVT-B-OFFSET',
          $4::timestamptz, $4::timestamptz + interval '60 minutes',
          false, false, now())`,
      [
        a,
        startAtB, // foreign A-event at B's time — must NOT touch B's slot
        b,
        new Date(Date.now() + 48 * 3600_000).toISOString(), // B's foreign event far from B's slot
      ],
    )

    const outA = await runConflictDetectionForTeacher({ teacherAccountId: a })
    expect(outA.ok).toBe(true)
    if (!outA.ok) return
    expect(outA.outcome.conflictsStamped).toBeGreaterThanOrEqual(1)

    const outB = await runConflictDetectionForTeacher({ teacherAccountId: b })
    expect(outB.ok).toBe(true)
    if (!outB.ok) return
    // B's slot does NOT overlap any of B's foreign busy intervals.
    expect(outB.outcome.conflictsStamped).toBe(0)

    // Cross-check the row level: A's slot has a stamp; B's slot does not.
    const rowA = await pool.query(
      `select external_conflict_at, conflict_source_calendar_id, conflict_source_event_id
         from lesson_slots where id = $1`,
      [slotA],
    )
    expect(rowA.rows[0].external_conflict_at).not.toBeNull()

    const rowB = await pool.query(
      `select external_conflict_at from lesson_slots where id = $1`,
      [slotB],
    )
    expect(rowB.rows[0].external_conflict_at).toBeNull()
  })
})
