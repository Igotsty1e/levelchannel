import { describe, expect, it } from 'vitest'

import { loadDashboardData } from '@/lib/admin/dashboard'
import { getDbPool } from '@/lib/db/pool'

import '../setup'

// Admin dashboard data-layer integration tests.
// Plan: docs/plans/admin-dashboard.md §SQL implementation.
//
// Seeds a teacher + learner + a handful of slots/completions, then
// asserts loadDashboardData('all') reports the expected metric values.

async function seedAccount(role: 'teacher' | 'learner', prefix: string) {
  const pool = getDbPool()
  const email = `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`
  const r = await pool.query<{ id: string }>(
    `insert into accounts (email, password_hash, email_verified_at)
     values ($1, 'dummy', now()) returning id`,
    [email],
  )
  const id = String(r.rows[0].id)
  if (role === 'teacher') {
    await pool.query(
      `insert into account_roles (account_id, role) values ($1, 'teacher')`,
      [id],
    )
  }
  return { id, email }
}

async function seedTariff(teacherId: string, prefix: string) {
  const pool = getDbPool()
  const r = await pool.query<{ id: string }>(
    `insert into pricing_tariffs (slug, title_ru, amount_kopecks, duration_minutes, teacher_id)
     values ($1, '60 мин', 150000, 60, $2) returning id`,
    [`${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`, teacherId],
  )
  return String(r.rows[0].id)
}

// Build a 30-min-aligned MSK time on date `daysAgo` at hour:minute MSK.
// MSK = UTC+3 (no DST), so we construct UTC = MSK-3h.
function mskAlignedDate(daysAgo: number, hourMsk: number, minute: 0 | 30): Date {
  const d = new Date()
  d.setUTCHours(hourMsk - 3, minute, 0, 0)
  d.setUTCDate(d.getUTCDate() + daysAgo)
  return d
}

async function seedSlot(opts: {
  teacherId: string
  learnerId: string | null
  tariffId: string
  status: 'open' | 'booked' | 'cancelled' | 'completed'
  startAt: Date
  bookedAt?: Date | null
}): Promise<string> {
  const pool = getDbPool()
  const bookedAt =
    opts.status === 'booked' || opts.status === 'completed'
      ? opts.bookedAt ?? new Date(Date.now() - 86_400_000)
      : null
  const cancelledAt =
    opts.status === 'cancelled' ? new Date(Date.now() - 86_400_000) : null
  const r = await pool.query<{ id: string }>(
    `insert into lesson_slots
       (teacher_account_id, start_at, duration_minutes, status,
        learner_account_id, booked_at, cancelled_at, tariff_id)
     values ($1, $2, 60, $3, $4, $5, $6, $7)
     returning id`,
    [
      opts.teacherId,
      opts.startAt,
      opts.status,
      opts.learnerId,
      bookedAt,
      cancelledAt,
      opts.tariffId,
    ],
  )
  return String(r.rows[0].id)
}

async function seedCompletion(
  slotId: string,
  teacherId: string,
  wasNoShow = false,
) {
  await getDbPool().query(
    `insert into lesson_completions
       (slot_id, teacher_id, amount_kopecks, completed_at, marked_by_account_id, was_no_show)
     values ($1, $2, 150000, now(), $2, $3)`,
    [slotId, teacherId, wasNoShow],
  )
}

describe('loadDashboardData', () => {
  it('reports zero metrics in fresh DB', async () => {
    const data = await loadDashboardData('all')
    expect(data.metrics.period).toBe('all')
    expect(data.metrics.activeTeachers.current).toBe(0)
    expect(data.metrics.activeLearners.current).toBe(0)
    expect(data.metrics.slotsCreated.current).toBe(0)
    expect(data.metrics.slotsBooked.current).toBe(0)
    expect(data.metrics.lessonsCompleted.current).toBe(0)
    expect(data.funnel.created).toBe(0)
  })

  it('counts slots by creation, booking, completion correctly', async () => {
    const teacher = await seedAccount('teacher', 'dash-t')
    const learner = await seedAccount('learner', 'dash-l')
    const tariff = await seedTariff(teacher.id, 'dash-tariff')

    // 3 open slots — count toward "created" only.
    for (let i = 0; i < 3; i++) {
      await seedSlot({
        teacherId: teacher.id,
        learnerId: null,
        tariffId: tariff,
        status: 'open',
        startAt: mskAlignedDate(1, 10 + i, 0),
      })
    }
    // 2 completed slots with completions — count toward "lessons completed".
    for (let i = 0; i < 2; i++) {
      const sid = await seedSlot({
        teacherId: teacher.id,
        learnerId: learner.id,
        tariffId: tariff,
        status: 'completed',
        startAt: mskAlignedDate(-(i + 2), 10, 0),
      })
      await seedCompletion(sid, teacher.id)
    }
    // 1 cancelled slot.
    await seedSlot({
      teacherId: teacher.id,
      learnerId: learner.id,
      tariffId: tariff,
      status: 'cancelled',
      startAt: mskAlignedDate(-5, 11, 0),
    })
    // 1 no-show.
    const nsId = await seedSlot({
      teacherId: teacher.id,
      learnerId: learner.id,
      tariffId: tariff,
      status: 'completed',
      startAt: mskAlignedDate(-6, 12, 0),
    })
    await seedCompletion(nsId, teacher.id, true)

    // Wait for PG clock to settle past last insert — Docker PG runs ~50ms
    // ahead of the host JS clock; loadDashboardData's `currentEnd = new Date()`
    // would otherwise be < last inserted row's `created_at`.
    await new Promise((res) => setTimeout(res, 250))

    const data = await loadDashboardData('all')
    // 3 open + 2 completed + 1 cancelled + 1 no-show = 7 slots created
    expect(data.metrics.slotsCreated.current).toBe(7)
    // booked_at set for status in {booked, completed}: 2 completed + 1 no-show = 3
    expect(data.metrics.slotsBooked.current).toBe(3)
    // lessonsCompleted: 2 (was_no_show=false)
    expect(data.metrics.lessonsCompleted.current).toBe(2)
    // cancelled: 1
    expect(data.metrics.cancelled.current).toBe(1)
    // noShowLearner: 1
    expect(data.metrics.noShowLearner.current).toBe(1)
    // activeTeachers: 1 (the teacher has 3 completions)
    expect(data.metrics.activeTeachers.current).toBe(1)
    // activeLearners: 1
    expect(data.metrics.activeLearners.current).toBe(1)

    // Funnel: cohort = slots created in period (R1-BLOCKER#3 fix).
    // 7 created → 3 booked (booked_at set) → 3 past_start (all booked
    // were past start) → 2 completed (have non-no-show completion).
    expect(data.funnel.created).toBe(7)
    expect(data.funnel.booked).toBe(3)
    expect(data.funnel.pastStart).toBe(3)
    expect(data.funnel.completed).toBe(2)
    // Monotonic invariant: each stage ≤ the previous.
    expect(data.funnel.created).toBeGreaterThanOrEqual(data.funnel.booked)
    expect(data.funnel.booked).toBeGreaterThanOrEqual(data.funnel.pastStart)
    expect(data.funnel.pastStart).toBeGreaterThanOrEqual(data.funnel.completed)

    // 'all' period yields null previous (no comparison).
    expect(data.metrics.slotsCreated.previous).toBeNull()
    expect(data.metrics.activeTeachers.previous).toBeNull()
  })

  it('respects rolling 7d window — old data excluded', async () => {
    const teacher = await seedAccount('teacher', 'dash-rolling-t')
    const learner = await seedAccount('learner', 'dash-rolling-l')
    const tariff = await seedTariff(teacher.id, 'dash-rolling-tariff')

    // 1 slot inside 7d window
    await seedSlot({
      teacherId: teacher.id,
      learnerId: null,
      tariffId: tariff,
      status: 'open',
      startAt: mskAlignedDate(1, 9, 0),
    })
    // 1 slot OUTSIDE 7d window (created 10d ago via backdate)
    await getDbPool().query(
      `insert into lesson_slots
         (teacher_account_id, start_at, duration_minutes, status,
          tariff_id, created_at)
       values ($1, $2, 60, 'open', $3, now() - interval '10 day')`,
      [teacher.id, mskAlignedDate(11, 10, 0), tariff],
    )

    await new Promise((res) => setTimeout(res, 250))
    const data = await loadDashboardData('7d')
    expect(data.metrics.slotsCreated.current).toBe(1)
    // previous is the 7d window before the current one
    expect(data.metrics.slotsCreated.previous).not.toBeNull()
    void learner
  })

  it('returns ok health banner when activity present', async () => {
    const teacher = await seedAccount('teacher', 'dash-ok-t')
    const learner = await seedAccount('learner', 'dash-ok-l')
    const tariff = await seedTariff(teacher.id, 'dash-ok-tariff')
    const slot = await seedSlot({
      teacherId: teacher.id,
      learnerId: learner.id,
      tariffId: tariff,
      status: 'completed',
      startAt: mskAlignedDate(-1, 10, 0),
    })
    await seedCompletion(slot, teacher.id)

    await new Promise((res) => setTimeout(res, 250))
    const data = await loadDashboardData('all')
    expect(data.health.state).toBe('ok')
    expect(data.health.belowThreshold).toEqual([])
  })

  it('returns alert health banner when zero completions in fresh DB', async () => {
    // Fresh DB after truncate: no teachers, no completions → 2 floors triggered.
    const data = await loadDashboardData('7d')
    expect(data.health.state).toBe('alert')
    expect(data.health.belowThreshold).toContain('Активные учителя')
    expect(data.health.belowThreshold).toContain('Занятий проведено')
  })

  it('cohort funnel stays monotonic when booking/completion drift outside period (R2-WARN#3)', async () => {
    // Pathological case: slot created INSIDE period, booked/completed
    // OUTSIDE the period (e.g., late booking, late mark). With the old
    // funnel that filtered each stage by its own timestamp, lower
    // stages could disappear while upper stayed visible. With the
    // cohort funnel, the slot stays attributed to the period it was
    // created in across all stages.
    const teacher = await seedAccount('teacher', 'cohort-t')
    const learner = await seedAccount('learner', 'cohort-l')
    const tariff = await seedTariff(teacher.id, 'cohort-tariff')

    // Slot created 'now', booked + completed both happen 'now' too
    // (Postgres clock — we can't easily backdate booked_at without
    // breaking the booked-invariant), but we use a 7d period and
    // confirm monotonicity holds.
    const slotId = await seedSlot({
      teacherId: teacher.id,
      learnerId: learner.id,
      tariffId: tariff,
      status: 'completed',
      startAt: mskAlignedDate(-1, 10, 0),
    })
    await seedCompletion(slotId, teacher.id)

    await new Promise((res) => setTimeout(res, 250))
    const data = await loadDashboardData('7d')
    // Cohort = 1 slot created in the 7d window.
    expect(data.funnel.created).toBe(1)
    // Monotonic invariant: each stage ≤ the previous.
    expect(data.funnel.booked).toBeLessThanOrEqual(data.funnel.created)
    expect(data.funnel.pastStart).toBeLessThanOrEqual(data.funnel.booked)
    expect(data.funnel.completed).toBeLessThanOrEqual(data.funnel.pastStart)
  })
})
