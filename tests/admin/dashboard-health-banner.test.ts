import { describe, expect, it } from 'vitest'

import { computeHealthBanner } from '@/lib/admin/dashboard'
import type { DashboardMetrics } from '@/lib/admin/dashboard-types'

const baseMetric = (current: number, previous: number | null = null) => ({
  current,
  previous,
})

const seed = (overrides: Partial<DashboardMetrics> = {}): DashboardMetrics => ({
  period: '7d',
  activeTeachers: baseMetric(10, 10),
  activeLearners: baseMetric(50, 50),
  slotsCreated: baseMetric(200, 200),
  slotsBooked: baseMetric(150, 150),
  lessonsCompleted: baseMetric(120, 120),
  cancelled: baseMetric(5, 5),
  noShowTeacher: baseMetric(0, 0),
  noShowLearner: baseMetric(2, 2),
  forgottenBookings: baseMetric(0, null),
  ...overrides,
})

describe('computeHealthBanner', () => {
  it('returns ok when all metrics healthy', () => {
    const banner = computeHealthBanner(seed())
    expect(banner.state).toBe('ok')
    expect(banner.belowThreshold).toEqual([])
  })

  it('returns alert when activeTeachers below absolute floor (0)', () => {
    const banner = computeHealthBanner(seed({ activeTeachers: baseMetric(0, 10) }))
    expect(banner.state).toBe('alert')
    expect(banner.belowThreshold).toContain('Активные учителя')
  })

  it('returns alert when lessonsCompleted below absolute floor (0)', () => {
    const banner = computeHealthBanner(seed({ lessonsCompleted: baseMetric(0, 120) }))
    expect(banner.state).toBe('alert')
    expect(banner.belowThreshold).toContain('Занятий проведено')
  })

  it('returns warn when activeTeachers dropped > 50% vs previous', () => {
    // 10 → 4 = -60%, current still > floor (≥1), so warn not alert.
    const banner = computeHealthBanner(seed({ activeTeachers: baseMetric(4, 10) }))
    expect(banner.state).toBe('warn')
    expect(banner.belowThreshold).toContain('Активные учителя')
  })

  it('upgrades warn to alert when 3+ metrics are below', () => {
    const banner = computeHealthBanner(
      seed({
        activeTeachers: baseMetric(4, 10), // -60% warn
        lessonsCompleted: baseMetric(40, 120), // -67% warn
        slotsCreated: baseMetric(50, 200), // -75% warn
      }),
    )
    expect(banner.state).toBe('alert')
    expect(banner.belowThreshold.length).toBeGreaterThanOrEqual(3)
  })

  it('skips delta check when previous is null (e.g. period=all)', () => {
    const banner = computeHealthBanner(
      seed({
        activeTeachers: baseMetric(5, null),
        lessonsCompleted: baseMetric(50, null),
        slotsCreated: baseMetric(100, null),
      }),
    )
    expect(banner.state).toBe('ok')
    expect(banner.belowThreshold).toEqual([])
  })

  it('does not trigger delta when previous is 0', () => {
    const banner = computeHealthBanner(
      seed({ activeTeachers: baseMetric(2, 0) }),
    )
    expect(banner.state).toBe('ok')
  })

  it('emits non-empty operator-readable reason on alert', () => {
    const banner = computeHealthBanner(seed({ activeTeachers: baseMetric(0, 10) }))
    expect(banner.reason).toMatch(/Активные учителя|критического/u)
    expect(banner.reason.length).toBeGreaterThan(0)
  })

  it('deduplicates a metric that trips both floor + delta (R1-WARN#5)', () => {
    // activeTeachers=0, previous=10 → trips floor (0 < 1) AND delta
    // (0 < 10/2). Before the fix, "Активные учителя" appeared twice
    // in belowThreshold and inflated the 3+-below count.
    const banner = computeHealthBanner(seed({ activeTeachers: baseMetric(0, 10) }))
    const matches = banner.belowThreshold.filter((s) => s === 'Активные учителя')
    expect(matches).toHaveLength(1)
  })

  it('the 3+ below escalation counts DISTINCT metrics, not occurrences', () => {
    // activeTeachers floor+delta would count as 2 before fix.
    // We seed only TWO distinct failing metrics + the dup; should NOT alert.
    const banner = computeHealthBanner(
      seed({
        activeTeachers: baseMetric(0, 10), // floor + delta = same metric
        lessonsCompleted: baseMetric(40, 120), // -67% warn
      }),
    )
    // Distinct labels: "Активные учителя", "Занятий проведено" = 2 < 3.
    // But activeTeachers tripped the absolute floor → alertHit=true.
    // Verify the 3+-below rule alone wouldn't have alerted (only 2 distinct).
    expect(banner.belowThreshold.length).toBe(2)
  })
})
