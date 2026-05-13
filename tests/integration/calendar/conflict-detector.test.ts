import { describe, expect, it } from 'vitest'

import {
  createAccount,
  grantAccountRole,
  normalizeAccountEmail,
} from '@/lib/auth/accounts'
import { hashPassword } from '@/lib/auth/password'
import { upsertAccountProfile } from '@/lib/auth/profiles'
import {
  listConflictsForSlot,
  runConflictDetectionForTeacher,
} from '@/lib/calendar/conflict-detector'
import { getDbPool } from '@/lib/db/pool'

import '../setup'

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

async function bookedSlot(
  teacherId: string,
  startIso: string,
  durationMinutes = 60,
): Promise<string> {
  const pool = getDbPool()
  const r = await pool.query(
    `insert into lesson_slots (id, teacher_account_id, start_at, duration_minutes, status,
                                learner_account_id, booked_at)
     values (gen_random_uuid(), $1, $2::timestamptz, $3, 'booked',
             $1, now())
     returning id`,
    [teacherId, startIso, durationMinutes],
  )
  return String(r.rows[0].id)
}

async function busyInterval(opts: {
  teacherId: string
  calId?: string
  eventId?: string
  startIso: string
  endIso: string
  is_own_event?: boolean
  is_orphan_self?: boolean
}): Promise<void> {
  await getDbPool().query(
    `insert into teacher_external_busy_intervals
        (id, teacher_account_id, external_calendar_id, external_event_id,
         start_at, end_at, is_own_event, is_orphan_self, fetched_at)
      values (
        gen_random_uuid(), $1, $2, $3, $4::timestamptz, $5::timestamptz,
        $6, $7, now()
      )`,
    [
      opts.teacherId,
      opts.calId ?? 'primary',
      opts.eventId ?? `evt-${Math.random().toString(36).slice(2)}`,
      opts.startIso,
      opts.endIso,
      opts.is_own_event ?? false,
      opts.is_orphan_self ?? false,
    ],
  )
}

async function readSlot(slotId: string) {
  const r = await getDbPool().query(
    `select external_conflict_at, external_conflict_kind,
            conflict_source_calendar_id, conflict_source_event_id
       from lesson_slots where id = $1`,
    [slotId],
  )
  return r.rows[0]
}

describe('runConflictDetectionForTeacher', () => {
  it('stamps conflict on a booked slot overlapping a foreign busy interval', async () => {
    const teacher = await makeTeacher('cd-stamp@example.com')
    const slot = await bookedSlot(teacher, '2026-08-01T10:00:00Z')
    await busyInterval({
      teacherId: teacher,
      calId: 'work@x',
      eventId: 'evt-dentist',
      startIso: '2026-08-01T09:30:00Z',
      endIso: '2026-08-01T10:30:00Z',
    })

    const r = await runConflictDetectionForTeacher({ teacherAccountId: teacher })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.outcome.conflictsStamped).toBe(1)

    const row = await readSlot(slot)
    expect(row.external_conflict_at).not.toBeNull()
    expect(row.external_conflict_kind).toBe('post_book_overlap')
    expect(row.conflict_source_calendar_id).toBe('work@x')
    expect(row.conflict_source_event_id).toBe('evt-dentist')
  })

  it('clears stale conflict when overlap no longer exists', async () => {
    const teacher = await makeTeacher('cd-clear@example.com')
    const slot = await bookedSlot(teacher, '2026-08-02T10:00:00Z')
    // Pre-stamp a stale conflict (no current busy row).
    await getDbPool().query(
      `update lesson_slots
          set external_conflict_at = now(),
              external_conflict_kind = 'post_book_overlap',
              conflict_source_calendar_id = 'old-cal',
              conflict_source_event_id = 'old-evt'
        where id = $1`,
      [slot],
    )
    const r = await runConflictDetectionForTeacher({ teacherAccountId: teacher })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.outcome.conflictsCleared).toBe(1)

    const row = await readSlot(slot)
    expect(row.external_conflict_at).toBeNull()
    expect(row.conflict_source_calendar_id).toBeNull()
  })

  it('ignores own_event busy rows (LC pushed events do not raise conflicts)', async () => {
    const teacher = await makeTeacher('cd-own@example.com')
    const slot = await bookedSlot(teacher, '2026-08-03T10:00:00Z')
    await busyInterval({
      teacherId: teacher,
      startIso: '2026-08-03T10:00:00Z',
      endIso: '2026-08-03T11:00:00Z',
      is_own_event: true,
    })
    const r = await runConflictDetectionForTeacher({ teacherAccountId: teacher })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.outcome.conflictsStamped).toBe(0)
      expect(r.outcome.scanned).toBe(1)
    }
    const row = await readSlot(slot)
    expect(row.external_conflict_at).toBeNull()
  })

  it('ignores orphan_self busy rows (post-reconnect — F8 UI handles)', async () => {
    const teacher = await makeTeacher('cd-orph@example.com')
    const slot = await bookedSlot(teacher, '2026-08-04T10:00:00Z')
    await busyInterval({
      teacherId: teacher,
      startIso: '2026-08-04T10:00:00Z',
      endIso: '2026-08-04T11:00:00Z',
      is_orphan_self: true,
    })
    const r = await runConflictDetectionForTeacher({ teacherAccountId: teacher })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.outcome.conflictsStamped).toBe(0)
  })

  it('does not churn updated_at on unchanged conflict', async () => {
    const teacher = await makeTeacher('cd-stable@example.com')
    const slot = await bookedSlot(teacher, '2026-08-05T10:00:00Z')
    await busyInterval({
      teacherId: teacher,
      calId: 'c1',
      eventId: 'e1',
      startIso: '2026-08-05T09:45:00Z',
      endIso: '2026-08-05T10:30:00Z',
    })
    // First pass — stamp.
    await runConflictDetectionForTeacher({ teacherAccountId: teacher })
    const before = await getDbPool().query(
      'select updated_at, external_conflict_at from lesson_slots where id = $1',
      [slot],
    )
    await new Promise((r) => setTimeout(r, 50))
    // Second pass — same overlap, must be no-op.
    const r2 = await runConflictDetectionForTeacher({ teacherAccountId: teacher })
    expect(r2.ok).toBe(true)
    if (r2.ok) expect(r2.outcome.conflictsUnchanged).toBe(1)

    const after = await getDbPool().query(
      'select updated_at, external_conflict_at from lesson_slots where id = $1',
      [slot],
    )
    expect(String(after.rows[0].updated_at)).toBe(String(before.rows[0].updated_at))
    expect(String(after.rows[0].external_conflict_at)).toBe(
      String(before.rows[0].external_conflict_at),
    )
  })

  it('re-stamps when conflict source changes (busy event id changes)', async () => {
    const teacher = await makeTeacher('cd-rstamp@example.com')
    const slot = await bookedSlot(teacher, '2026-08-06T10:00:00Z')
    await busyInterval({
      teacherId: teacher,
      eventId: 'old-evt',
      startIso: '2026-08-06T09:45:00Z',
      endIso: '2026-08-06T10:30:00Z',
    })
    await runConflictDetectionForTeacher({ teacherAccountId: teacher })
    // Replace busy interval with a different event.
    await getDbPool().query(
      `delete from teacher_external_busy_intervals where teacher_account_id = $1`,
      [teacher],
    )
    await busyInterval({
      teacherId: teacher,
      eventId: 'new-evt',
      startIso: '2026-08-06T09:50:00Z',
      endIso: '2026-08-06T10:30:00Z',
    })
    const r2 = await runConflictDetectionForTeacher({ teacherAccountId: teacher })
    expect(r2.ok).toBe(true)
    if (r2.ok) expect(r2.outcome.conflictsStamped).toBe(1)
    const row = await readSlot(slot)
    expect(row.conflict_source_event_id).toBe('new-evt')
  })

  it('does not affect non-booked slots', async () => {
    const teacher = await makeTeacher('cd-status@example.com')
    const pool = getDbPool()
    // Open slot — never gets conflict stamp.
    const openSlot = await pool.query(
      `insert into lesson_slots (id, teacher_account_id, start_at, duration_minutes, status)
       values (gen_random_uuid(), $1, $2::timestamptz, 60, 'open')
       returning id`,
      [teacher, '2026-08-07T10:00:00Z'],
    )
    await busyInterval({
      teacherId: teacher,
      startIso: '2026-08-07T10:00:00Z',
      endIso: '2026-08-07T11:00:00Z',
    })
    const r = await runConflictDetectionForTeacher({ teacherAccountId: teacher })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.outcome.scanned).toBe(0) // open slot not counted
    const row = await readSlot(String(openSlot.rows[0].id))
    expect(row.external_conflict_at).toBeNull()
  })

  it('picks earliest overlap deterministically when multiple overlaps exist', async () => {
    const teacher = await makeTeacher('cd-multi@example.com')
    const slot = await bookedSlot(teacher, '2026-08-08T10:00:00Z')
    await busyInterval({
      teacherId: teacher,
      eventId: 'evt-later',
      startIso: '2026-08-08T10:30:00Z',
      endIso: '2026-08-08T11:00:00Z',
    })
    await busyInterval({
      teacherId: teacher,
      eventId: 'evt-earlier',
      startIso: '2026-08-08T10:00:00Z',
      endIso: '2026-08-08T10:30:00Z',
    })
    const r = await runConflictDetectionForTeacher({ teacherAccountId: teacher })
    expect(r.ok).toBe(true)
    const row = await readSlot(slot)
    expect(row.conflict_source_event_id).toBe('evt-earlier')
  })

  it('rejects non-UUID accountId', async () => {
    const r = await runConflictDetectionForTeacher({
      teacherAccountId: 'not-a-uuid',
    })
    expect(r.ok).toBe(false)
  })
})

describe('listConflictsForSlot', () => {
  it('returns all overlapping foreign busy intervals (ordered)', async () => {
    const teacher = await makeTeacher('lcs-1@example.com')
    const slot = await bookedSlot(teacher, '2026-09-01T10:00:00Z')
    await busyInterval({
      teacherId: teacher,
      eventId: 'B',
      startIso: '2026-09-01T10:15:00Z',
      endIso: '2026-09-01T10:30:00Z',
    })
    await busyInterval({
      teacherId: teacher,
      eventId: 'A',
      startIso: '2026-09-01T10:00:00Z',
      endIso: '2026-09-01T10:15:00Z',
    })
    // Own event mustn't appear.
    await busyInterval({
      teacherId: teacher,
      eventId: 'OWN',
      startIso: '2026-09-01T10:30:00Z',
      endIso: '2026-09-01T10:45:00Z',
      is_own_event: true,
    })
    const r = await listConflictsForSlot({ slotId: slot })
    expect(r.slot).not.toBeNull()
    expect(r.overlaps).toHaveLength(2)
    expect(r.overlaps.map((o) => o.externalEventId)).toEqual(['A', 'B'])
  })

  it('returns empty overlaps when there are none', async () => {
    const teacher = await makeTeacher('lcs-2@example.com')
    const slot = await bookedSlot(teacher, '2026-09-02T10:00:00Z')
    const r = await listConflictsForSlot({ slotId: slot })
    expect(r.overlaps).toEqual([])
  })

  it('returns null slot on non-UUID', async () => {
    const r = await listConflictsForSlot({ slotId: 'not-uuid' })
    expect(r.slot).toBeNull()
  })
})
