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
  evaluatePathology,
  listPathologicalSlots,
} from '@/lib/calendar/pathology'
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

function alignedMskStartAt(offsetDays: number): string {
  const target = new Date(Date.now() + offsetDays * 24 * 60 * 60_000)
  target.setUTCHours(7, 0, 0, 0)
  return target.toISOString()
}

async function seedCancelledSlot(opts: {
  teacherId: string
  cancelRepushCount: number
  externalEventId: string
  startOffsetDays?: number
  withExternalBinding?: boolean
}): Promise<string> {
  const startAt = alignedMskStartAt(opts.startOffsetDays ?? 7)
  const insR = await getDbPool().query(
    `insert into lesson_slots (id, teacher_account_id, start_at,
                               duration_minutes, status)
     values (gen_random_uuid(), $1::uuid, $2::timestamptz, 60, 'open')
     returning id`,
    [opts.teacherId, startAt],
  )
  const slotId = String(insR.rows[0].id)
  const withBinding = opts.withExternalBinding !== false
  await getDbPool().query(
    `update lesson_slots
        set status = 'cancelled',
            cancelled_at = now(),
            external_calendar_id = $1::text,
            external_event_id = $2::text,
            cancel_repush_count = $3::int
      where id = $4::uuid`,
    [
      withBinding ? 'primary' : null,
      withBinding ? opts.externalEventId : null,
      opts.cancelRepushCount,
      slotId,
    ],
  )
  return slotId
}

describe('listPathologicalSlots', () => {
  it('returns empty when no slot meets threshold', async () => {
    const t = await makeTeacher('pa1@example.com')
    await seedCancelledSlot({
      teacherId: t,
      cancelRepushCount: 1,
      externalEventId: 'evt-low',
    })
    const list = await listPathologicalSlots()
    expect(list).toHaveLength(0)
  })

  it('returns rows at or above default threshold (3)', async () => {
    const t = await makeTeacher('pa2@example.com')
    await seedCancelledSlot({
      teacherId: t,
      cancelRepushCount: 1,
      externalEventId: 'evt-1',
    })
    const slotAt3 = await seedCancelledSlot({
      teacherId: t,
      cancelRepushCount: 3,
      externalEventId: 'evt-3',
      startOffsetDays: 8,
    })
    const slotAt5 = await seedCancelledSlot({
      teacherId: t,
      cancelRepushCount: 5,
      externalEventId: 'evt-5',
      startOffsetDays: 9,
    })

    const list = await listPathologicalSlots()
    expect(list).toHaveLength(2)
    // Order: highest count first, then start_at asc.
    expect(list[0]?.slotId).toBe(slotAt5)
    expect(list[1]?.slotId).toBe(slotAt3)
  })

  it('honours a custom threshold', async () => {
    const t = await makeTeacher('pa3@example.com')
    await seedCancelledSlot({
      teacherId: t,
      cancelRepushCount: 2,
      externalEventId: 'evt-c1',
    })
    await seedCancelledSlot({
      teacherId: t,
      cancelRepushCount: 6,
      externalEventId: 'evt-c2',
      startOffsetDays: 8,
    })

    expect(await listPathologicalSlots({ threshold: 5 })).toHaveLength(1)
    expect(await listPathologicalSlots({ threshold: 2 })).toHaveLength(2)
  })

  it('excludes slots whose binding has been unbound (external_event_id IS NULL)', async () => {
    // The reconciler's drift-resolution unbind takes a previously-
    // resurrecting slot OUT of pathology — the loop is broken once
    // the binding is gone.
    const t = await makeTeacher('pa4@example.com')
    await seedCancelledSlot({
      teacherId: t,
      cancelRepushCount: 5,
      externalEventId: 'evt-unbound',
      withExternalBinding: false,
    })

    expect(await listPathologicalSlots()).toHaveLength(0)
  })

  it('excludes non-cancelled slots even with high counter (defensive)', async () => {
    const t = await makeTeacher('pa5@example.com')
    const insR = await getDbPool().query(
      `insert into lesson_slots (id, teacher_account_id, start_at,
                                 duration_minutes, status)
       values (gen_random_uuid(), $1::uuid, $2::timestamptz, 60, 'open')
       returning id`,
      [t, alignedMskStartAt(7)],
    )
    const slotId = String(insR.rows[0].id)
    // Slot stays in 'open' status — should never have cancel_repush_count
    // bumped, but if some bug ever sets it, the alert SQL must NOT
    // fire for non-cancelled rows.
    await getDbPool().query(
      `update lesson_slots
          set external_calendar_id = 'primary',
              external_event_id = 'evt-leak',
              cancel_repush_count = 9
        where id = $1::uuid`,
      [slotId],
    )

    expect(await listPathologicalSlots()).toHaveLength(0)
  })
})

describe('evaluatePathology', () => {
  it('returns ok verdict when nothing crosses threshold', async () => {
    const t = await makeTeacher('pa6@example.com')
    await seedCancelledSlot({
      teacherId: t,
      cancelRepushCount: 1,
      externalEventId: 'evt-ok',
    })
    const v = await evaluatePathology()
    expect(v).toEqual({ kind: 'ok' })
  })

  it('returns alert verdict with offender details', async () => {
    const t = await makeTeacher('pa7@example.com')
    const slot = await seedCancelledSlot({
      teacherId: t,
      cancelRepushCount: 4,
      externalEventId: 'evt-alert',
    })
    const v = await evaluatePathology()
    expect(v.kind).toBe('alert')
    if (v.kind !== 'alert') return
    expect(v.count).toBe(1)
    expect(v.threshold).toBe(3)
    expect(v.offenders[0]?.slotId).toBe(slot)
    expect(v.offenders[0]?.cancelRepushCount).toBe(4)
  })
})
