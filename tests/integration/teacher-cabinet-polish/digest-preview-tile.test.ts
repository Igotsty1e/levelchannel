// Teacher-cabinet-polish (2026-05-23) — TASK-3 Sub-PR D.
//
// Round-2 test: seed a teacher with 3 booked slots inside the teacher's
// local "today" (MSK 06:00..22:00 band), assert `getTeacherDigestPreview`
// returns 3 rows in ascending `start_at` order.

import { describe, expect, it } from 'vitest'

import { createAccount, grantAccountRole, normalizeAccountEmail } from '@/lib/auth/accounts'
import { hashPassword } from '@/lib/auth/password'
import { getDbPool } from '@/lib/db/pool'
import { getTeacherDigestPreview } from '@/lib/notifications/teacher-digest-preview'

import '../setup'

async function makeTeacherMsk(emailPrefix: string): Promise<string> {
  const acc = await createAccount({
    email: normalizeAccountEmail(
      `${emailPrefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`,
    ),
    passwordHash: await hashPassword('StrongPassword123'),
  })
  await grantAccountRole(acc.id, 'teacher', null)
  await getDbPool().query(
    `insert into account_profiles (account_id, timezone, display_name)
       values ($1::uuid, 'Europe/Moscow', 'Учитель Тестовый')
     on conflict (account_id) do update
       set timezone = excluded.timezone,
           display_name = excluded.display_name,
           updated_at = now()`,
    [acc.id],
  )
  return acc.id
}

async function makeLearner(emailPrefix: string, displayName: string | null): Promise<string> {
  const acc = await createAccount({
    email: normalizeAccountEmail(
      `${emailPrefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`,
    ),
    passwordHash: await hashPassword('StrongPassword123'),
  })
  if (displayName !== null) {
    await getDbPool().query(
      `insert into account_profiles (account_id, display_name)
         values ($1::uuid, $2)`,
      [acc.id, displayName],
    )
  }
  return acc.id
}

// Compute an ISO timestamp for today MSK at `localHour:minute` MSK.
// 30-min aligned + inside the 06..22 business band (CHECK constraints
// at the lesson_slots layer enforce both invariants).
async function todayMskIsoAtHourMinute(
  localHour: number,
  minute: 0 | 30 = 0,
): Promise<string> {
  const pool = getDbPool()
  const r = await pool.query(
    `select (
       date_trunc('day', now() AT TIME ZONE 'Europe/Moscow')
       + ($1::int || ' hours')::interval
       + ($2::int || ' minutes')::interval
     ) AT TIME ZONE 'Europe/Moscow' as ts`,
    [localHour, minute],
  )
  return new Date(String(r.rows[0].ts)).toISOString()
}

async function seedBookedSlot(opts: {
  teacherId: string
  learnerId: string
  startAtUtcIso: string
  zoomUrl?: string | null
}): Promise<string> {
  const pool = getDbPool()
  const ins = await pool.query(
    `insert into lesson_slots
       (id, teacher_account_id, start_at, duration_minutes, status)
       values (gen_random_uuid(), $1::uuid, $2::timestamptz, 60, 'open')
       returning id`,
    [opts.teacherId, opts.startAtUtcIso],
  )
  const slotId = String(ins.rows[0].id)
  await pool.query(
    `update lesson_slots
        set status = 'booked',
            learner_account_id = $1::uuid,
            booked_at = now(),
            zoom_url = $2
      where id = $3::uuid`,
    [opts.learnerId, opts.zoomUrl ?? null, slotId],
  )
  return slotId
}

describe('getTeacherDigestPreview — 3-slot today_local list', () => {
  it('returns the 3 booked slots in ascending start_at order', async () => {
    const teacherId = await makeTeacherMsk('digest-preview-3slot')
    const learnerA = await makeLearner('learner-a', 'Анна Иванова')
    const learnerB = await makeLearner('learner-b', null) // null display → fallback to email
    const learnerC = await makeLearner('learner-c', 'Сергей Петров')

    // Seed 3 booked slots in today_msk: 08:00, 12:00, 18:00 — all in
    // band (06..22 MSK) and 30-min aligned. Insert order is C/A/B to
    // verify SQL ORDER BY ascending start_at (not insert order).
    const slotAt08 = await todayMskIsoAtHourMinute(8)
    const slotAt12 = await todayMskIsoAtHourMinute(12)
    const slotAt18 = await todayMskIsoAtHourMinute(18)

    await seedBookedSlot({
      teacherId,
      learnerId: learnerC,
      startAtUtcIso: slotAt18,
      zoomUrl: 'https://zoom.us/j/example-c',
    })
    await seedBookedSlot({
      teacherId,
      learnerId: learnerA,
      startAtUtcIso: slotAt08,
      zoomUrl: 'https://zoom.us/j/example-a',
    })
    await seedBookedSlot({
      teacherId,
      learnerId: learnerB,
      startAtUtcIso: slotAt12,
      zoomUrl: null,
    })

    const preview = await getTeacherDigestPreview(teacherId)

    expect(preview.teacherTz).toBe('Europe/Moscow')
    expect(preview.slots.length).toBe(3)

    // Ascending start_at order: 08:00 → 12:00 → 18:00.
    const startEpochs = preview.slots.map((s) => Date.parse(s.startAt))
    expect(startEpochs[0]).toBeLessThan(startEpochs[1])
    expect(startEpochs[1]).toBeLessThan(startEpochs[2])

    // Learner names propagated where present; null where absent.
    expect(preview.slots[0].learnerName).toBe('Анна Иванова')
    expect(preview.slots[1].learnerName).toBeNull()
    expect(preview.slots[2].learnerName).toBe('Сергей Петров')

    // Learner emails present on every row.
    for (const slot of preview.slots) {
      expect(slot.learnerEmail).toBeTruthy()
    }

    // zoom_url propagated as-is (null for slot 2).
    expect(preview.slots[0].zoomUrl).toBe('https://zoom.us/j/example-a')
    expect(preview.slots[1].zoomUrl).toBeNull()
    expect(preview.slots[2].zoomUrl).toBe('https://zoom.us/j/example-c')

    // todayLocalYmd shape (YYYY-MM-DD).
    expect(preview.todayLocalYmd).toMatch(/^\d{4}-\d{2}-\d{2}$/)

    // All slot statuses are 'booked' (the SQL filter pin).
    for (const slot of preview.slots) {
      expect(slot.status).toBe('booked')
    }
  })
})
