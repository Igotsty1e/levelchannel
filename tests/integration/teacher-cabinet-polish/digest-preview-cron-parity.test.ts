// Teacher-cabinet-polish (2026-05-23) — TASK-3 Sub-PR D, round-2
// BLOCKER #2 closure.
//
// SQL parity: `getTeacherDigestPreview` (the dashboard tile helper)
// and `selectTeacherSlotsForLocalDay` (the cron's per-teacher SELECT
// at scripts/teacher-daily-digest.mjs) MUST resolve the same row set
// for a teacher whose slots straddle the today_local boundary.
//
// Test setup uses teacher_tz = Europe/Moscow because the
// `lesson_slots_start_in_business_hours` CHECK constraint is MSK-
// anchored (06..22 MSK only). The plan-doc illustrative pair
// "today_local 22:00 MSK + tomorrow_local 00:30 MSK" cannot ship as-
// is because 00:30 violates the MSK business-band CHECK; we use the
// nearest legal pair (today_local 22:00 MSK + tomorrow_local 06:00
// MSK), which straddles the same midnight boundary the plan calls
// out, just on the first-allowed slot of the next day instead of the
// inside-band-rejected 00:30 candidate. The boundary semantics are
// identical: today_msk 22:00 IS in today_local, tomorrow_msk 06:00
// IS in tomorrow_local for an MSK teacher.

import { dirname, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'

import { beforeAll, describe, expect, it } from 'vitest'

import { createAccount, grantAccountRole, normalizeAccountEmail } from '@/lib/auth/accounts'
import { hashPassword } from '@/lib/auth/password'
import { getDbPool } from '@/lib/db/pool'
import { getTeacherDigestPreview } from '@/lib/notifications/teacher-digest-preview'

import '../setup'

const here = dirname(fileURLToPath(import.meta.url))
const mjsPath = resolvePath(
  here,
  '../../../scripts/teacher-daily-digest.mjs',
)

type DigestModule = typeof import('../../../scripts/teacher-daily-digest.mjs')
let mod: DigestModule

beforeAll(async () => {
  mod = (await import(mjsPath)) as DigestModule
})

async function makeMskTeacher(emailPrefix: string): Promise<string> {
  const acc = await createAccount({
    email: normalizeAccountEmail(
      `${emailPrefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`,
    ),
    passwordHash: await hashPassword('StrongPassword123'),
  })
  await grantAccountRole(acc.id, 'teacher', null)
  await getDbPool().query(
    `insert into account_profiles (account_id, timezone)
       values ($1::uuid, 'Europe/Moscow')
     on conflict (account_id) do update
       set timezone = excluded.timezone, updated_at = now()`,
    [acc.id],
  )
  return acc.id
}

async function makeLearner(emailPrefix: string): Promise<string> {
  const acc = await createAccount({
    email: normalizeAccountEmail(
      `${emailPrefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`,
    ),
    passwordHash: await hashPassword('StrongPassword123'),
  })
  return acc.id
}

// Build ISO timestamp for `today_msk + offsetDays @ hour:0 MSK`.
async function dayOffsetMskAtHour(
  offsetDays: number,
  hour: number,
): Promise<string> {
  const pool = getDbPool()
  const r = await pool.query(
    `select (
       date_trunc('day', now() AT TIME ZONE 'Europe/Moscow')
       + ($1::int || ' days')::interval
       + ($2::int || ' hours')::interval
     ) AT TIME ZONE 'Europe/Moscow' as ts`,
    [offsetDays, hour],
  )
  return new Date(String(r.rows[0].ts)).toISOString()
}

async function seedBookedSlot(opts: {
  teacherId: string
  learnerId: string
  startAtUtcIso: string
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
            booked_at = now()
      where id = $2::uuid`,
    [opts.learnerId, slotId],
  )
  return slotId
}

describe('digest-preview ↔ cron SQL parity', () => {
  it('boundary-straddling pair: helper + cron both return ONLY today_local slot', async () => {
    const teacherId = await makeMskTeacher('parity')
    const learnerId = await makeLearner('learner-p')

    // Slot A — today_local 22:00 MSK. Last legal in-band slot for
    // today_msk per the MSK business-band CHECK. INSIDE today_local.
    const slotATodayIso = await dayOffsetMskAtHour(0, 22)
    const slotAId = await seedBookedSlot({
      teacherId,
      learnerId,
      startAtUtcIso: slotATodayIso,
    })

    // Slot B — tomorrow_local 06:00 MSK. First legal in-band slot of
    // tomorrow_msk. OUTSIDE today_local. (The plan's illustrative
    // 00:30 candidate is unschedulable per the MSK business-band
    // CHECK; 06:00 is the nearest tomorrow-side legal value and
    // exercises the same boundary semantics.)
    const slotBTomorrowIso = await dayOffsetMskAtHour(1, 6)
    await seedBookedSlot({
      teacherId,
      learnerId,
      startAtUtcIso: slotBTomorrowIso,
    })

    // Sanity: also seed a yesterday slot at 08:00 MSK to confirm the
    // lower-bound predicate excludes prior-day rows too.
    const slotCYesterdayIso = await dayOffsetMskAtHour(-1, 8)
    await seedBookedSlot({
      teacherId,
      learnerId,
      startAtUtcIso: slotCYesterdayIso,
    })

    // (1) Helper.
    const preview = await getTeacherDigestPreview(teacherId)
    expect(preview.teacherTz).toBe('Europe/Moscow')
    const helperIds = preview.slots.map((s) => s.id)
    expect(helperIds).toEqual([slotAId])

    // (2) Cron's per-teacher SELECT with the same today_local_ymd.
    // The cron computes today_local via `nowInTimezoneParts(now,
    // 'Europe/Moscow')`, then passes it as $2 into the SQL. We pull
    // the same date Postgres-side to remove any JS/Postgres clock skew
    // from the comparison.
    const todayRow = await getDbPool().query<{ today_local: string }>(
      `select (now() AT TIME ZONE 'Europe/Moscow')::date::text as today_local`,
    )
    const todayLocalYmd = String(todayRow.rows[0].today_local)
    const cronRows = await mod.selectTeacherSlotsForLocalDay(
      getDbPool(),
      teacherId,
      todayLocalYmd,
      'Europe/Moscow',
    )
    const cronIds = cronRows.map((r) => r.slotId)
    expect(cronIds).toEqual([slotAId])

    // (3) Parity assertion: helper and cron resolve the same set.
    expect(helperIds).toEqual(cronIds)
  })
})
