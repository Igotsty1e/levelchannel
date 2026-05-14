import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  createAccount,
  grantAccountRole,
  normalizeAccountEmail,
} from '@/lib/auth/accounts'
import { hashPassword } from '@/lib/auth/password'
import { upsertAccountProfile } from '@/lib/auth/profiles'
import { __resetCalendarEncryptionKeyCache } from '@/lib/calendar/encryption'
import {
  countHiddenSlotsForTeacher,
  listHiddenSlotsForTeacher,
} from '@/lib/calendar/hidden-slots'
import { upsertGoogleIntegration } from '@/lib/calendar/integrations'
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
})

async function makeTeacher(email: string): Promise<string> {
  const a = await createAccount({
    email: normalizeAccountEmail(email),
    passwordHash: await hashPassword('StrongPassword123'),
  })
  await grantAccountRole(a.id, 'teacher', null)
  await upsertAccountProfile(a.id, {
    displayName: 'T',
    timezone: 'Europe/Moscow',
    locale: 'ru',
  })
  return a.id
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

function alignedMskStartAt(offsetDays: number, mskHour = 10): string {
  const target = new Date(Date.now() + offsetDays * 24 * 60 * 60_000)
  target.setUTCHours(mskHour - 3, 0, 0, 0)
  return target.toISOString()
}

async function seedOpenSlot(opts: {
  teacherId: string
  startAtIso: string
  durationMinutes?: number
}): Promise<string> {
  const r = await getDbPool().query(
    `insert into lesson_slots (id, teacher_account_id, start_at,
                               duration_minutes, status)
     values (gen_random_uuid(), $1::uuid, $2::timestamptz, $3::int, 'open')
     returning id`,
    [opts.teacherId, opts.startAtIso, opts.durationMinutes ?? 60],
  )
  return String(r.rows[0].id)
}

async function seedBusyInterval(opts: {
  teacherId: string
  startAtIso: string
  endAtIso: string
  isOwnEvent?: boolean
  externalCalendarId?: string
  externalEventId?: string
}): Promise<void> {
  await getDbPool().query(
    `insert into teacher_external_busy_intervals
       (teacher_account_id, external_calendar_id, external_event_id,
        start_at, end_at, is_all_day, is_writable_in_source,
        is_own_event)
     values ($1::uuid, $2::text, $3::text,
             $4::timestamptz, $5::timestamptz, false, true, $6::bool)`,
    [
      opts.teacherId,
      opts.externalCalendarId ?? 'primary',
      opts.externalEventId ?? `evt-${Math.random().toString(36).slice(2, 10)}`,
      opts.startAtIso,
      opts.endAtIso,
      opts.isOwnEvent ?? false,
    ],
  )
}

describe('listHiddenSlotsForTeacher', () => {
  it('returns slots whose window overlaps a foreign busy interval', async () => {
    const t = await makeTeacher('hs1@example.com')
    await connect(t)
    const startIso = alignedMskStartAt(7)
    const endIso = new Date(
      new Date(startIso).getTime() + 60 * 60_000,
    ).toISOString()
    const slot = await seedOpenSlot({ teacherId: t, startAtIso: startIso })
    await seedBusyInterval({
      teacherId: t,
      startAtIso: startIso,
      endAtIso: endIso,
    })

    const list = await listHiddenSlotsForTeacher({ teacherAccountId: t })

    expect(list).toHaveLength(1)
    expect(list[0]?.slotId).toBe(slot)
    expect(list[0]?.conflictCount).toBe(1)
    expect(list[0]?.firstConflictExternalCalendarId).toBe('primary')
  })

  it('does NOT surface slots overlapping our own pushed events (is_own_event = true)', async () => {
    const t = await makeTeacher('hs2@example.com')
    await connect(t)
    const startIso = alignedMskStartAt(8)
    const endIso = new Date(
      new Date(startIso).getTime() + 60 * 60_000,
    ).toISOString()
    await seedOpenSlot({ teacherId: t, startAtIso: startIso })
    await seedBusyInterval({
      teacherId: t,
      startAtIso: startIso,
      endAtIso: endIso,
      isOwnEvent: true,
    })

    const list = await listHiddenSlotsForTeacher({ teacherAccountId: t })

    expect(list).toEqual([])
  })

  it('aggregates multi-event overlap into conflictCount', async () => {
    const t = await makeTeacher('hs3@example.com')
    await connect(t)
    const startIso = alignedMskStartAt(9)
    const endIso = new Date(
      new Date(startIso).getTime() + 60 * 60_000,
    ).toISOString()
    await seedOpenSlot({ teacherId: t, startAtIso: startIso })
    await seedBusyInterval({
      teacherId: t,
      startAtIso: startIso,
      endAtIso: endIso,
      externalEventId: 'evt-a',
    })
    await seedBusyInterval({
      teacherId: t,
      startAtIso: new Date(
        new Date(startIso).getTime() + 15 * 60_000,
      ).toISOString(),
      endAtIso: new Date(
        new Date(startIso).getTime() + 45 * 60_000,
      ).toISOString(),
      externalEventId: 'evt-b',
    })

    const list = await listHiddenSlotsForTeacher({ teacherAccountId: t })

    expect(list).toHaveLength(1)
    expect(list[0]?.conflictCount).toBe(2)
  })

  it('omits slots whose window does NOT overlap any busy interval', async () => {
    const t = await makeTeacher('hs4@example.com')
    await connect(t)
    const startIso = alignedMskStartAt(10)
    await seedOpenSlot({ teacherId: t, startAtIso: startIso })
    // Busy interval is a different day entirely.
    await seedBusyInterval({
      teacherId: t,
      startAtIso: alignedMskStartAt(20),
      endAtIso: new Date(
        new Date(alignedMskStartAt(20)).getTime() + 60 * 60_000,
      ).toISOString(),
    })

    const list = await listHiddenSlotsForTeacher({ teacherAccountId: t })

    expect(list).toEqual([])
  })

  it('excludes already-booked slots — only status=open is returned', async () => {
    const t = await makeTeacher('hs5@example.com')
    await connect(t)
    const startIso = alignedMskStartAt(11)
    const endIso = new Date(
      new Date(startIso).getTime() + 60 * 60_000,
    ).toISOString()
    const learner = await makeTeacher('hs5l@example.com') // any account works
    const slot = await seedOpenSlot({ teacherId: t, startAtIso: startIso })
    await getDbPool().query(
      `update lesson_slots
          set status = 'booked', learner_account_id = $1::uuid,
              booked_at = now()
        where id = $2::uuid`,
      [learner, slot],
    )
    await seedBusyInterval({
      teacherId: t,
      startAtIso: startIso,
      endAtIso: endIso,
    })

    const list = await listHiddenSlotsForTeacher({ teacherAccountId: t })

    expect(list).toEqual([])
  })

  it('excludes slots in the past', async () => {
    const t = await makeTeacher('hs6@example.com')
    await connect(t)
    // start_at in the past — past slots cannot be hidden from
    // learners (the learner's calendar already filters past).
    const pastStart = new Date(Date.now() - 2 * 60 * 60_000)
    pastStart.setUTCHours(7, 0, 0, 0) // MSK 10:00 yesterday or earlier
    pastStart.setUTCDate(pastStart.getUTCDate() - 1)
    const pastIso = pastStart.toISOString()
    const r = await getDbPool().query(
      `insert into lesson_slots (id, teacher_account_id, start_at,
                                 duration_minutes, status)
       values (gen_random_uuid(), $1::uuid, $2::timestamptz, 60, 'open')
       returning id`,
      [t, pastIso],
    )
    const slotId = String(r.rows[0].id)
    await seedBusyInterval({
      teacherId: t,
      startAtIso: pastIso,
      endAtIso: new Date(
        new Date(pastIso).getTime() + 60 * 60_000,
      ).toISOString(),
    })

    const list = await listHiddenSlotsForTeacher({ teacherAccountId: t })

    expect(list.find((s) => s.slotId === slotId)).toBeUndefined()
  })

  it('countHiddenSlotsForTeacher matches the list length', async () => {
    const t = await makeTeacher('hs7@example.com')
    await connect(t)
    expect(await countHiddenSlotsForTeacher(t)).toBe(0)

    const startIso = alignedMskStartAt(12)
    const endIso = new Date(
      new Date(startIso).getTime() + 60 * 60_000,
    ).toISOString()
    await seedOpenSlot({ teacherId: t, startAtIso: startIso })
    await seedBusyInterval({
      teacherId: t,
      startAtIso: startIso,
      endAtIso: endIso,
    })

    expect(await countHiddenSlotsForTeacher(t)).toBe(1)
    const list = await listHiddenSlotsForTeacher({ teacherAccountId: t })
    expect(list).toHaveLength(1)
  })

  it('returns [] for a non-UUID teacher id (defensive)', async () => {
    expect(
      await listHiddenSlotsForTeacher({ teacherAccountId: 'not-a-uuid' }),
    ).toEqual([])
    expect(await countHiddenSlotsForTeacher('not-a-uuid')).toBe(0)
  })
})
