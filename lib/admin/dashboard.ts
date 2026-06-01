// Admin dashboard data layer — 9 metrics + sparklines + funnel + users
// dynamics + health banner.
//
// Plan: docs/plans/admin-dashboard.md §SQL implementation.
//
// All time-buckets use Europe/Moscow timezone via `date_trunc AT TIME ZONE`.

import { getDbPool } from '@/lib/db/pool'

import type {
  DashboardData,
  DashboardFunnel,
  DashboardMetrics,
  DashboardSparklines,
  DashboardUsersDynamics,
  HealthBanner,
  HealthBannerState,
  MetricValue,
  SparklineSeries,
} from './dashboard-types'
import type { PeriodKey, PeriodWindow } from './dashboard-period'
import { buildPeriodWindow } from './dashboard-period'

const TZ = 'Europe/Moscow'

/** Critical absolute floors (R3-CPO #O fix). */
const ABSOLUTE_FLOORS: Record<string, number> = {
  activeTeachers: 1,     // < 1 active teacher = 🚨
  lessonsCompleted: 1,   // < 1 lesson in period = 🚨
}

type MetricRow = { current: string | number; previous: string | number | null }

async function readMetricValue(
  sql: string,
  params: ReadonlyArray<unknown>,
): Promise<MetricValue> {
  const r = await getDbPool().query<MetricRow>(sql, params as unknown[])
  const row = r.rows[0]
  return {
    current: Number(row?.current ?? 0),
    previous: row?.previous === null || row?.previous === undefined ? null : Number(row.previous),
  }
}

function paramsFor(w: PeriodWindow): {
  currentStart: Date
  currentEnd: Date
  previousStart: Date | null
  previousEnd: Date | null
} {
  return {
    currentStart: w.currentStart,
    currentEnd: w.currentEnd,
    previousStart: w.previousStart,
    previousEnd: w.previousEnd,
  }
}

// R1-WARN#4: prefer the schema's dedicated timestamp for each terminal
// status — `cancelled_at` for cancellations (mig 0020), `marked_at`
// for lifecycle states (mig 0021). `updated_at` would shift a terminal
// row's period when ANY subsequent column-touch happens.
type TerminalTsColumn = 'cancelled_at' | 'marked_at'

async function metricSlotsByStatus(
  status: 'cancelled' | 'completed' | 'no_show_teacher' | 'no_show_learner',
  tsColumn: TerminalTsColumn,
  w: PeriodWindow,
): Promise<MetricValue> {
  const p = paramsFor(w)
  return readMetricValue(
    `select
       (select count(*)::bigint from lesson_slots
         where status = $1 and ${tsColumn} >= $2 and ${tsColumn} < $3) as current,
       case when $4::timestamptz is null then null else
         (select count(*)::bigint from lesson_slots
           where status = $1 and ${tsColumn} >= $4 and ${tsColumn} < $5)
       end as previous`,
    [status, p.currentStart, p.currentEnd, p.previousStart, p.previousEnd],
  )
}

async function metricActiveTeachers(w: PeriodWindow): Promise<MetricValue> {
  const p = paramsFor(w)
  // R1-BLOCKER#2: use lesson_completions.completed_at (business time —
  // when the lesson actually happened) not created_at (when operator
  // marked, may be a late backfill).
  return readMetricValue(
    `select
       (select count(distinct teacher_id)::bigint from lesson_completions
         where completed_at >= $1 and completed_at < $2) as current,
       case when $3::timestamptz is null then null else
         (select count(distinct teacher_id)::bigint from lesson_completions
           where completed_at >= $3 and completed_at < $4)
       end as previous`,
    [p.currentStart, p.currentEnd, p.previousStart, p.previousEnd],
  )
}

async function metricActiveLearners(w: PeriodWindow): Promise<MetricValue> {
  const p = paramsFor(w)
  return readMetricValue(
    `select
       (select count(distinct s.learner_account_id)::bigint
          from lesson_completions lc
          join lesson_slots s on s.id = lc.slot_id
         where lc.completed_at >= $1 and lc.completed_at < $2
           and s.learner_account_id is not null) as current,
       case when $3::timestamptz is null then null else
         (select count(distinct s.learner_account_id)::bigint
            from lesson_completions lc
            join lesson_slots s on s.id = lc.slot_id
           where lc.completed_at >= $3 and lc.completed_at < $4
             and s.learner_account_id is not null)
       end as previous`,
    [p.currentStart, p.currentEnd, p.previousStart, p.previousEnd],
  )
}

async function metricSlotsCreated(w: PeriodWindow): Promise<MetricValue> {
  const p = paramsFor(w)
  return readMetricValue(
    `select
       (select count(*)::bigint from lesson_slots
         where created_at >= $1 and created_at < $2) as current,
       case when $3::timestamptz is null then null else
         (select count(*)::bigint from lesson_slots
           where created_at >= $3 and created_at < $4)
       end as previous`,
    [p.currentStart, p.currentEnd, p.previousStart, p.previousEnd],
  )
}

async function metricSlotsBooked(w: PeriodWindow): Promise<MetricValue> {
  const p = paramsFor(w)
  return readMetricValue(
    `select
       (select count(*)::bigint from lesson_slots
         where booked_at is not null and booked_at >= $1 and booked_at < $2) as current,
       case when $3::timestamptz is null then null else
         (select count(*)::bigint from lesson_slots
           where booked_at is not null and booked_at >= $3 and booked_at < $4)
       end as previous`,
    [p.currentStart, p.currentEnd, p.previousStart, p.previousEnd],
  )
}

async function metricLessonsCompleted(w: PeriodWindow): Promise<MetricValue> {
  const p = paramsFor(w)
  return readMetricValue(
    `select
       (select count(*)::bigint from lesson_completions
         where was_no_show = false and completed_at >= $1 and completed_at < $2) as current,
       case when $3::timestamptz is null then null else
         (select count(*)::bigint from lesson_completions
           where was_no_show = false and completed_at >= $3 and completed_at < $4)
       end as previous`,
    [p.currentStart, p.currentEnd, p.previousStart, p.previousEnd],
  )
}

async function metricNoShowLearner(w: PeriodWindow): Promise<MetricValue> {
  const p = paramsFor(w)
  return readMetricValue(
    `select
       (select count(*)::bigint from lesson_completions
         where was_no_show = true and completed_at >= $1 and completed_at < $2) as current,
       case when $3::timestamptz is null then null else
         (select count(*)::bigint from lesson_completions
           where was_no_show = true and completed_at >= $3 and completed_at < $4)
       end as previous`,
    [p.currentStart, p.currentEnd, p.previousStart, p.previousEnd],
  )
}

async function metricForgottenBookings(): Promise<MetricValue> {
  // "Прошли start_at но не отмечены" — current snapshot only, no prev.
  const r = await getDbPool().query<{ current: string }>(
    `select count(*)::bigint as current
       from lesson_slots
      where status = 'booked'
        and start_at + (duration_minutes || ' minutes')::interval < now()`,
  )
  return { current: Number(r.rows[0]?.current ?? 0), previous: null }
}

async function readSparkline(
  w: PeriodWindow,
  source: 'created' | 'booked' | 'completed' | 'cancelled',
): Promise<SparklineSeries> {
  const truncUnit = w.bucketIntervalSql.includes('hour')
    ? 'hour'
    : w.bucketIntervalSql.includes('day')
      ? 'day'
      : 'week'
  let inner: string
  // R1-BLOCKER#2: completed sparkline keys on lesson_completions.completed_at
  // (business time). R1-WARN#4: cancelled sparkline keys on lesson_slots.cancelled_at.
  if (source === 'created') {
    inner = `select date_trunc('${truncUnit}', created_at at time zone $3) as b, count(*)::bigint as n
               from lesson_slots
              where created_at >= $1 and created_at < $2
              group by 1`
  } else if (source === 'booked') {
    inner = `select date_trunc('${truncUnit}', booked_at at time zone $3) as b, count(*)::bigint as n
               from lesson_slots
              where booked_at is not null and booked_at >= $1 and booked_at < $2
              group by 1`
  } else if (source === 'completed') {
    inner = `select date_trunc('${truncUnit}', completed_at at time zone $3) as b, count(*)::bigint as n
               from lesson_completions
              where was_no_show = false and completed_at >= $1 and completed_at < $2
              group by 1`
  } else {
    inner = `select date_trunc('${truncUnit}', cancelled_at at time zone $3) as b, count(*)::bigint as n
               from lesson_slots
              where status = 'cancelled' and cancelled_at >= $1 and cancelled_at < $2
              group by 1`
  }
  // Use bucketRangeStart so 'all' caps at ~6 months instead of epoch.
  const r = await getDbPool().query<{ bucket: string; value: string }>(
    `with d as (${inner})
     select to_char(b at time zone $3, 'YYYY-MM-DD"T"HH24:MI:SS') as bucket,
            n::bigint as value
       from d
      order by b`,
    [w.bucketRangeStart, w.currentEnd, TZ],
  )
  return {
    buckets: r.rows.map((row) => ({ bucket: row.bucket, value: Number(row.value) })),
  }
}

async function readFunnel(w: PeriodWindow): Promise<DashboardFunnel> {
  const p = paramsFor(w)
  // R1-BLOCKER#3: cohort = slots CREATED in [currentStart, currentEnd).
  // All four stages count subsets of the same cohort so the funnel is
  // monotonically decreasing (no impossible >100% conversion).
  const r = await getDbPool().query<{
    created: string
    booked: string
    past_start: string
    completed: string
  }>(
    `with cohort as (
       select id, start_at, duration_minutes, booked_at
         from lesson_slots
        where created_at >= $1 and created_at < $2
     )
     select
       count(*)::bigint as created,
       count(*) filter (where booked_at is not null)::bigint as booked,
       count(*) filter (where booked_at is not null
         and start_at + (duration_minutes || ' minutes')::interval < now())::bigint as past_start,
       (select count(*)::bigint from cohort c
          where c.booked_at is not null
            and exists (
              select 1 from lesson_completions lc
               where lc.slot_id = c.id and lc.was_no_show = false)
       ) as completed
     from cohort`,
    [p.currentStart, p.currentEnd],
  )
  const row = r.rows[0]
  return {
    created: Number(row?.created ?? 0),
    booked: Number(row?.booked ?? 0),
    pastStart: Number(row?.past_start ?? 0),
    completed: Number(row?.completed ?? 0),
  }
}

async function readUsersDynamics(w: PeriodWindow): Promise<DashboardUsersDynamics> {
  const truncUnit = w.bucketIntervalSql.includes('hour')
    ? 'hour'
    : w.bucketIntervalSql.includes('day')
      ? 'day'
      : 'week'
  // generate_series is inclusive on both ends; subtract one step from
  // the end so we get exactly bucketCount buckets (R1-BLOCKER#1 fix).
  // Use `bucketRangeStart` (not `currentStart`) so the 'all' period
  // caps at ~6 months of weekly buckets instead of ~2900 from epoch.
  const r = await getDbPool().query<{
    bucket: string
    teachers: string
    learners: string
  }>(
    `with buckets as (
       select date_trunc('${truncUnit}',
                generate_series($1::timestamptz,
                                $2::timestamptz - $3::interval,
                                $3::interval)
                at time zone $4) as b
     )
     select to_char(b.b, 'YYYY-MM-DD"T"HH24:MI:SS') as bucket,
            (select count(distinct teacher_id)::bigint from lesson_completions lc
              where date_trunc('${truncUnit}', lc.completed_at at time zone $4) = b.b) as teachers,
            (select count(distinct s.learner_account_id)::bigint from lesson_completions lc
                join lesson_slots s on s.id = lc.slot_id
              where date_trunc('${truncUnit}', lc.completed_at at time zone $4) = b.b
                and s.learner_account_id is not null) as learners
       from buckets b
      order by b.b`,
    [w.bucketRangeStart, w.currentEnd, w.bucketIntervalSql, TZ],
  )
  return {
    buckets: r.rows.map((row) => ({
      bucket: row.bucket,
      teachers: Number(row.teachers ?? 0),
      learners: Number(row.learners ?? 0),
    })),
  }
}

export function computeHealthBanner(metrics: DashboardMetrics): HealthBanner {
  // R1-WARN#5: dedupe via Set — a metric that trips BOTH the floor
  // and the delta check (e.g. activeTeachers=0 with previous=10) was
  // previously pushed twice, inflating `below.length` and the 3+-below
  // escalation rule.
  const belowSet = new Set<string>()
  let alertHit = false
  let warnHit = false

  // (O) Absolute floors first — hardest gate.
  const floorChecks: Array<[keyof typeof ABSOLUTE_FLOORS, string]> = [
    ['activeTeachers', 'Активные учителя'],
    ['lessonsCompleted', 'Занятий проведено'],
  ]
  for (const [key, label] of floorChecks) {
    const m = metrics[key as keyof DashboardMetrics] as MetricValue
    if (m.current < ABSOLUTE_FLOORS[key]) {
      belowSet.add(label)
      alertHit = true
    }
  }

  // Delta-based: if current < prev / 2, treat as below benchmark.
  const deltaChecks: Array<[MetricValue, string]> = [
    [metrics.activeTeachers, 'Активные учителя'],
    [metrics.lessonsCompleted, 'Занятий проведено'],
    [metrics.slotsCreated, 'Слотов создано'],
  ]
  for (const [m, label] of deltaChecks) {
    if (m.previous === null) continue
    if (m.previous > 0 && m.current < m.previous * 0.5) {
      belowSet.add(label)
      warnHit = true
    }
  }

  const below = Array.from(belowSet)
  // 3+ distinct below = alert (regardless of category).
  if (below.length >= 3) alertHit = true

  const state: HealthBannerState = alertHit ? 'alert' : warnHit ? 'warn' : 'ok'

  let reason: string
  if (state === 'ok') {
    reason = 'Платформа в норме'
  } else if (state === 'warn') {
    reason = `${below.length} метрик ниже нормы`
  } else {
    reason =
      below.length === 1
        ? `🚨 ${below[0]} ниже критического порога`
        : `🚨 ${below.length} метрик ниже критического порога`
  }
  return { state, reason, belowThreshold: below }
}

/**
 * Top-level batch loader. Runs all queries in parallel.
 */
export async function loadDashboardData(period: PeriodKey): Promise<DashboardData> {
  const w = buildPeriodWindow(period)

  const [
    activeTeachers,
    activeLearners,
    slotsCreated,
    slotsBooked,
    lessonsCompleted,
    cancelled,
    noShowTeacher,
    noShowLearner,
    forgottenBookings,
    sparklineCreated,
    sparklineBooked,
    sparklineCompleted,
    sparklineCancelled,
    funnel,
    usersDynamics,
  ] = await Promise.all([
    metricActiveTeachers(w),
    metricActiveLearners(w),
    metricSlotsCreated(w),
    metricSlotsBooked(w),
    metricLessonsCompleted(w),
    metricSlotsByStatus('cancelled', 'cancelled_at', w),
    metricSlotsByStatus('no_show_teacher', 'marked_at', w),
    metricNoShowLearner(w),
    metricForgottenBookings(),
    readSparkline(w, 'created'),
    readSparkline(w, 'booked'),
    readSparkline(w, 'completed'),
    readSparkline(w, 'cancelled'),
    readFunnel(w),
    readUsersDynamics(w),
  ])

  const metrics: DashboardMetrics = {
    period,
    activeTeachers,
    activeLearners,
    slotsCreated,
    slotsBooked,
    lessonsCompleted,
    cancelled,
    noShowTeacher,
    noShowLearner,
    forgottenBookings,
  }
  const sparklines: DashboardSparklines = {
    slotsCreated: sparklineCreated,
    slotsBooked: sparklineBooked,
    lessonsCompleted: sparklineCompleted,
    cancelled: sparklineCancelled,
  }
  const health = computeHealthBanner(metrics)

  return { metrics, sparklines, funnel, usersDynamics, health }
}
