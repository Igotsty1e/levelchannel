import { describe, expect, it } from 'vitest'

import { getDbPool } from '@/lib/db/pool'

import '../setup'

// T3 Sub-PR A — exercise the forward trigger + immutability guard on
// lesson_slots.snapshot_amount_kopecks (mig 0102 §d).

async function seedTeacherAndTariff(prefix: string) {
  const pool = getDbPool()
  const t = await pool.query<{ id: string }>(
    `insert into accounts (email, password_hash, email_verified_at)
     values ($1, 'dummy', now()) returning id`,
    [`${prefix}-t-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`],
  )
  const teacherId = String(t.rows[0].id)
  await pool.query(
    `insert into account_roles (account_id, role) values ($1, 'teacher')`,
    [teacherId],
  )
  const tariff = await pool.query<{ id: string }>(
    `insert into pricing_tariffs (slug, title_ru, amount_kopecks, duration_minutes, teacher_id)
     values ($1, '60 мин', 150000, 60, $2) returning id, amount_kopecks`,
    [`${prefix}-tariff-${Date.now()}-${Math.floor(Math.random() * 1e6)}`, teacherId],
  )
  return { teacherId, tariffId: String(tariff.rows[0].id) }
}

function alignedTs(daysOffset: number, hourMsk: number): Date {
  const d = new Date()
  d.setUTCHours(hourMsk - 3, 0, 0, 0)
  d.setUTCDate(d.getUTCDate() + daysOffset)
  return d
}

describe('lesson_slots.snapshot_amount_kopecks trigger (mig 0102 §d)', () => {
  it('open → booked transition fills snapshot from catalog when app omits it', async () => {
    const { teacherId, tariffId } = await seedTeacherAndTariff('snap-fill')
    const pool = getDbPool()
    const ins = await pool.query<{ id: string; snapshot_amount_kopecks: number | null }>(
      `insert into lesson_slots
         (teacher_account_id, start_at, duration_minutes, status, tariff_id)
       values ($1, $2, 60, 'open', $3)
       returning id, snapshot_amount_kopecks`,
      [teacherId, alignedTs(2, 10), tariffId],
    )
    const slotId = String(ins.rows[0].id)
    expect(ins.rows[0].snapshot_amount_kopecks).toBeNull()
    // Seed a learner so booked status passes the booked-invariant.
    const learner = await pool.query<{ id: string }>(
      `insert into accounts (email, password_hash, email_verified_at)
       values ($1, 'dummy', now()) returning id`,
      [`snap-fill-l-${Date.now()}@example.com`],
    )
    const learnerId = String(learner.rows[0].id)
    // App-side UPDATE WITHOUT setting snapshot_amount_kopecks — trigger
    // falls back to catalog price.
    const upd = await pool.query<{ snapshot_amount_kopecks: number }>(
      `update lesson_slots
          set status = 'booked',
              learner_account_id = $1,
              booked_at = now()
        where id = $2
        returning snapshot_amount_kopecks`,
      [learnerId, slotId],
    )
    expect(upd.rows[0].snapshot_amount_kopecks).toBe(150000)
  })

  it('app-side UPDATE with explicit snapshot is preserved (not overwritten)', async () => {
    const { teacherId, tariffId } = await seedTeacherAndTariff('snap-app')
    const pool = getDbPool()
    const ins = await pool.query<{ id: string }>(
      `insert into lesson_slots
         (teacher_account_id, start_at, duration_minutes, status, tariff_id)
       values ($1, $2, 60, 'open', $3) returning id`,
      [teacherId, alignedTs(2, 11), tariffId],
    )
    const slotId = String(ins.rows[0].id)
    const learner = await pool.query<{ id: string }>(
      `insert into accounts (email, password_hash, email_verified_at)
       values ($1, 'dummy', now()) returning id`,
      [`snap-app-l-${Date.now()}@example.com`],
    )
    const learnerId = String(learner.rows[0].id)
    // App passes an override 130000 (different from catalog 150000) in
    // the SAME UPDATE that flips status — trigger sees NEW.snapshot
    // non-NULL and short-circuits.
    const upd = await pool.query<{ snapshot_amount_kopecks: number }>(
      `update lesson_slots
          set status = 'booked',
              learner_account_id = $1,
              booked_at = now(),
              snapshot_amount_kopecks = 130000
        where id = $2
        returning snapshot_amount_kopecks`,
      [learnerId, slotId],
    )
    expect(upd.rows[0].snapshot_amount_kopecks).toBe(130000)
  })

  it('immutability guard rejects post-booking snapshot edit', async () => {
    const { teacherId, tariffId } = await seedTeacherAndTariff('snap-immut')
    const pool = getDbPool()
    const ins = await pool.query<{ id: string }>(
      `insert into lesson_slots
         (teacher_account_id, start_at, duration_minutes, status, tariff_id)
       values ($1, $2, 60, 'open', $3) returning id`,
      [teacherId, alignedTs(2, 12), tariffId],
    )
    const slotId = String(ins.rows[0].id)
    const learner = await pool.query<{ id: string }>(
      `insert into accounts (email, password_hash, email_verified_at)
       values ($1, 'dummy', now()) returning id`,
      [`snap-immut-l-${Date.now()}@example.com`],
    )
    const learnerId = String(learner.rows[0].id)
    // First flip into booked with snapshot 130000.
    await pool.query(
      `update lesson_slots
          set status = 'booked',
              learner_account_id = $1,
              booked_at = now(),
              snapshot_amount_kopecks = 130000
        where id = $2`,
      [learnerId, slotId],
    )
    // Now try to mutate the snapshot — trigger raises.
    await expect(
      pool.query(
        `update lesson_slots set snapshot_amount_kopecks = 90000 where id = $1`,
        [slotId],
      ),
    ).rejects.toThrow(/immutable/)
  })
})
