import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  createAccount,
  grantAccountRole,
  normalizeAccountEmail,
} from '@/lib/auth/accounts'
import { hashPassword } from '@/lib/auth/password'
import { upsertAccountProfile } from '@/lib/auth/profiles'
import { __resetCalendarEncryptionKeyCache } from '@/lib/calendar/encryption'
import { upsertGoogleIntegration } from '@/lib/calendar/integrations'
import {
  ignoreAllOrphanSelfSlotsForTeacher,
  ignoreOrphanSelfSlot,
  listOrphanSelfSlotsForTeacher,
} from '@/lib/calendar/orphan-cleanup'
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

async function connect(accountId: string): Promise<string> {
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
  if (!r.ok) throw new Error(`upsert failed: ${r.error.code}`)
  const row = await getDbPool().query(
    `select epoch from teacher_calendar_integrations where account_id = $1`,
    [accountId],
  )
  return String(row.rows[0].epoch)
}

function alignedMskStartAt(offsetDays: number): string {
  const target = new Date(Date.now() + offsetDays * 24 * 60 * 60_000)
  target.setUTCHours(7, 0, 0, 0)
  return target.toISOString()
}

async function seedSlotWithBinding(opts: {
  teacherId: string
  startOffsetDays: number
  externalEventId: string
  integrationEpoch: string | null
  externalCalendarId?: string
}): Promise<string> {
  const startAt = alignedMskStartAt(opts.startOffsetDays)
  const insR = await getDbPool().query(
    `insert into lesson_slots (id, teacher_account_id, start_at,
                               duration_minutes, status)
     values (gen_random_uuid(), $1::uuid, $2::timestamptz, 60, 'open')
     returning id`,
    [opts.teacherId, startAt],
  )
  const slotId = String(insR.rows[0].id)
  await getDbPool().query(
    `update lesson_slots
        set external_calendar_id = $1::text,
            external_event_id = $2::text,
            integration_epoch = $3::text
      where id = $4::uuid`,
    [
      opts.externalCalendarId ?? 'primary',
      opts.externalEventId,
      opts.integrationEpoch,
      slotId,
    ],
  )
  return slotId
}

describe('listOrphanSelfSlotsForTeacher', () => {
  it('returns slots whose integration_epoch != current tci.epoch', async () => {
    const t = await makeTeacher('os1@example.com')
    const currentEpoch = await connect(t)
    const orphan = await seedSlotWithBinding({
      teacherId: t,
      startOffsetDays: 7,
      externalEventId: 'evt-old',
      integrationEpoch: 'totally-old-epoch',
    })
    const fresh = await seedSlotWithBinding({
      teacherId: t,
      startOffsetDays: 8,
      externalEventId: 'evt-fresh',
      integrationEpoch: currentEpoch,
    })

    const list = await listOrphanSelfSlotsForTeacher(t)
    expect(list).toHaveLength(1)
    expect(list[0]?.slotId).toBe(orphan)
    expect(list[0]?.staleEpoch).toBe('totally-old-epoch')
    const ids = list.map((s) => s.slotId)
    expect(ids).not.toContain(fresh)
  })

  it('omits slots with NULL integration_epoch (pre-Phase-1 bindings)', async () => {
    const t = await makeTeacher('os2@example.com')
    await connect(t)
    await seedSlotWithBinding({
      teacherId: t,
      startOffsetDays: 7,
      externalEventId: 'evt-no-epoch',
      integrationEpoch: null,
    })
    expect(await listOrphanSelfSlotsForTeacher(t)).toHaveLength(0)
  })

  it('omits slots with NULL external_event_id', async () => {
    const t = await makeTeacher('os3@example.com')
    await connect(t)
    await getDbPool().query(
      `insert into lesson_slots (id, teacher_account_id, start_at,
                                 duration_minutes, status)
       values (gen_random_uuid(), $1::uuid, $2::timestamptz, 60, 'open')`,
      [t, alignedMskStartAt(7)],
    )
    expect(await listOrphanSelfSlotsForTeacher(t)).toHaveLength(0)
  })

  it('returns [] for a non-UUID teacher id (defensive)', async () => {
    expect(await listOrphanSelfSlotsForTeacher('not-a-uuid')).toEqual([])
  })
})

describe('ignoreOrphanSelfSlot', () => {
  it('NULLs the binding when epoch mismatch', async () => {
    const t = await makeTeacher('os4@example.com')
    await connect(t)
    const slot = await seedSlotWithBinding({
      teacherId: t,
      startOffsetDays: 7,
      externalEventId: 'evt-stale',
      integrationEpoch: 'previous-epoch',
    })

    const r = await ignoreOrphanSelfSlot({
      teacherAccountId: t,
      slotId: slot,
    })
    expect(r).toEqual({ ok: true, ignored: 1 })

    const after = await getDbPool().query(
      `select external_event_id, integration_epoch, last_reconciled_at
         from lesson_slots where id = $1`,
      [slot],
    )
    expect(after.rows[0].external_event_id).toBeNull()
    expect(after.rows[0].integration_epoch).toBeNull()
    expect(after.rows[0].last_reconciled_at).not.toBeNull()
  })

  it('refuses to NULL a slot whose epoch matches current tci.epoch', async () => {
    const t = await makeTeacher('os5@example.com')
    const currentEpoch = await connect(t)
    const slot = await seedSlotWithBinding({
      teacherId: t,
      startOffsetDays: 7,
      externalEventId: 'evt-fresh',
      integrationEpoch: currentEpoch,
    })

    const r = await ignoreOrphanSelfSlot({
      teacherAccountId: t,
      slotId: slot,
    })
    expect(r).toEqual({ ok: false, reason: 'no_match' })

    const after = await getDbPool().query(
      `select external_event_id from lesson_slots where id = $1`,
      [slot],
    )
    expect(after.rows[0].external_event_id).toBe('evt-fresh')
  })

  it('does not let teacher A clear teacher B\'s orphan slot', async () => {
    const a = await makeTeacher('os6a@example.com')
    const b = await makeTeacher('os6b@example.com')
    await connect(a)
    await connect(b)
    const slotB = await seedSlotWithBinding({
      teacherId: b,
      startOffsetDays: 7,
      externalEventId: 'evt-b',
      integrationEpoch: 'old',
    })

    const r = await ignoreOrphanSelfSlot({
      teacherAccountId: a,
      slotId: slotB,
    })
    expect(r).toEqual({ ok: false, reason: 'no_match' })
  })
})

describe('ignoreAllOrphanSelfSlotsForTeacher', () => {
  it('clears every orphan-self slot for the teacher', async () => {
    const t = await makeTeacher('os7@example.com')
    const currentEpoch = await connect(t)
    await seedSlotWithBinding({
      teacherId: t,
      startOffsetDays: 7,
      externalEventId: 'evt-o1',
      integrationEpoch: 'old',
    })
    await seedSlotWithBinding({
      teacherId: t,
      startOffsetDays: 8,
      externalEventId: 'evt-o2',
      integrationEpoch: 'older',
    })
    const fresh = await seedSlotWithBinding({
      teacherId: t,
      startOffsetDays: 9,
      externalEventId: 'evt-current',
      integrationEpoch: currentEpoch,
    })

    const r = await ignoreAllOrphanSelfSlotsForTeacher(t)
    expect(r.ignored).toBe(2)

    // The current-epoch slot is untouched.
    const after = await getDbPool().query(
      `select external_event_id from lesson_slots where id = $1`,
      [fresh],
    )
    expect(after.rows[0].external_event_id).toBe('evt-current')

    // List is now empty.
    expect(await listOrphanSelfSlotsForTeacher(t)).toHaveLength(0)
  })

  it('returns ignored=0 when there are no orphans', async () => {
    const t = await makeTeacher('os8@example.com')
    await connect(t)
    const r = await ignoreAllOrphanSelfSlotsForTeacher(t)
    expect(r).toEqual({ ignored: 0 })
  })
})
