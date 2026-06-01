// Admin dashboard typed shapes.
// Plan: docs/plans/admin-dashboard.md §Tech stack.

import type { PeriodKey } from './dashboard-period'

export type MetricValue = {
  current: number
  previous: number | null
}

export type BucketPoint = {
  bucket: string  // ISO timestamp
  value: number
}

export type DashboardMetrics = {
  period: PeriodKey
  activeTeachers: MetricValue
  activeLearners: MetricValue
  slotsCreated: MetricValue
  slotsBooked: MetricValue
  lessonsCompleted: MetricValue
  cancelled: MetricValue
  noShowTeacher: MetricValue
  noShowLearner: MetricValue
  /** Слоты которые прошли start_at но не отмечены (booked + past). */
  forgottenBookings: MetricValue
}

export type SparklineSeries = {
  buckets: BucketPoint[]  // bucket start ISO + count
}

export type DashboardSparklines = {
  slotsCreated: SparklineSeries
  slotsBooked: SparklineSeries
  lessonsCompleted: SparklineSeries
  cancelled: SparklineSeries
}

export type DashboardFunnel = {
  created: number
  booked: number
  pastStart: number
  completed: number
}

export type DashboardUsersDynamics = {
  buckets: { bucket: string; teachers: number; learners: number }[]
}

export type HealthBannerState = 'ok' | 'warn' | 'alert'

export type HealthBanner = {
  state: HealthBannerState
  reason: string  // operator-readable explanation
  belowThreshold: ReadonlyArray<string>  // metric names below benchmark
}

export type DashboardData = {
  metrics: DashboardMetrics
  sparklines: DashboardSparklines
  funnel: DashboardFunnel
  usersDynamics: DashboardUsersDynamics
  health: HealthBanner
}
