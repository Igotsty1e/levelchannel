// Admin dashboard period util tests.
// Plan: docs/plans/admin-dashboard.md §Period filter.

import { describe, expect, it } from 'vitest'

import {
  DEFAULT_PERIOD,
  buildPeriodWindow,
  formatDelta,
  parsePeriodOrDefault,
} from '@/lib/admin/dashboard-period'

describe('parsePeriodOrDefault', () => {
  it('returns default for null/undefined', () => {
    expect(parsePeriodOrDefault(null)).toBe(DEFAULT_PERIOD)
    expect(parsePeriodOrDefault(undefined)).toBe(DEFAULT_PERIOD)
    expect(parsePeriodOrDefault('')).toBe(DEFAULT_PERIOD)
  })

  it('accepts allowlist values', () => {
    expect(parsePeriodOrDefault('1d')).toBe('1d')
    expect(parsePeriodOrDefault('7d')).toBe('7d')
    expect(parsePeriodOrDefault('30d')).toBe('30d')
    expect(parsePeriodOrDefault('all')).toBe('all')
  })

  it('rejects garbage with fallback', () => {
    expect(parsePeriodOrDefault('14d')).toBe(DEFAULT_PERIOD)
    expect(parsePeriodOrDefault('999d')).toBe(DEFAULT_PERIOD)
    expect(parsePeriodOrDefault('forever')).toBe(DEFAULT_PERIOD)
    expect(parsePeriodOrDefault('1D')).toBe(DEFAULT_PERIOD)  // case-sensitive
  })
})

describe('buildPeriodWindow', () => {
  const NOW = new Date('2026-06-01T12:00:00Z')

  it('1d → 24h current + 24h prev + hourly buckets', () => {
    const w = buildPeriodWindow('1d', NOW)
    expect(w.currentEnd).toEqual(NOW)
    expect(w.currentStart.getTime()).toBe(NOW.getTime() - 24 * 60 * 60 * 1000)
    expect(w.previousEnd).toEqual(w.currentStart)
    expect(w.previousStart!.getTime()).toBe(NOW.getTime() - 48 * 60 * 60 * 1000)
    expect(w.bucketRangeStart).toEqual(w.currentStart)  // non-'all' parity
    expect(w.bucketIntervalSql).toBe('1 hour')
    expect(w.bucketCount).toBe(24)
    expect(w.showDelta).toBe(true)
  })

  it('7d → 168h current + prev + daily buckets', () => {
    const w = buildPeriodWindow('7d', NOW)
    expect(w.currentStart.getTime()).toBe(NOW.getTime() - 7 * 24 * 60 * 60 * 1000)
    expect(w.bucketIntervalSql).toBe('1 day')
    expect(w.bucketCount).toBe(7)
  })

  it('30d → 30 days', () => {
    const w = buildPeriodWindow('30d', NOW)
    expect(w.currentStart.getTime()).toBe(NOW.getTime() - 30 * 24 * 60 * 60 * 1000)
    expect(w.bucketCount).toBe(30)
  })

  it("'all' → epoch start + no prior period + weekly buckets", () => {
    const w = buildPeriodWindow('all', NOW)
    expect(w.currentStart.getTime()).toBe(0)
    expect(w.previousStart).toBeNull()
    expect(w.previousEnd).toBeNull()
    expect(w.showDelta).toBe(false)
    expect(w.bucketIntervalSql).toBe('7 days')
    expect(w.bucketCount).toBe(26)
    // bucketRangeStart caps at bucketCount × 7d ago (~6 months), NOT epoch.
    // Without this cap the dynamics chart would render ~2900 weekly buckets.
    expect(w.bucketRangeStart.getTime()).toBe(NOW.getTime() - 26 * 7 * 24 * 60 * 60 * 1000)
  })

  it('bucketCount × step exactly spans [bucketRangeStart, currentEnd)', () => {
    // R1-BLOCKER#1 + R2-WARN#3: pin the exact bucket count for each
    // period so a future refactor that re-introduces generate_series
    // off-by-one or drops the 'all' cap goes red here.
    const cases: Array<[
      '1d' | '7d' | '30d' | 'all',
      number,  // bucketCount
      number,  // stepMs
    ]> = [
      ['1d', 24, 60 * 60 * 1000],
      ['7d', 7, 24 * 60 * 60 * 1000],
      ['30d', 30, 24 * 60 * 60 * 1000],
      ['all', 26, 7 * 24 * 60 * 60 * 1000],
    ]
    for (const [key, count, stepMs] of cases) {
      const w = buildPeriodWindow(key, NOW)
      const spanMs = w.currentEnd.getTime() - w.bucketRangeStart.getTime()
      expect(spanMs).toBe(count * stepMs)
      expect(w.bucketCount).toBe(count)
    }
  })
})

describe('formatDelta', () => {
  it('returns em-dash for null prev', () => {
    expect(formatDelta(42, null)).toBe('—')
  })

  it('returns em-dash for zero prev (no division by zero)', () => {
    expect(formatDelta(42, 0)).toBe('—')
  })

  it('positive delta with sign', () => {
    expect(formatDelta(120, 100)).toBe('+20%')
  })

  it('negative delta', () => {
    expect(formatDelta(80, 100)).toBe('-20%')
  })

  it('zero delta', () => {
    expect(formatDelta(100, 100)).toBe('+0%')
  })

  it('rounds to nearest int', () => {
    expect(formatDelta(133, 100)).toBe('+33%')
    expect(formatDelta(166, 100)).toBe('+66%')
  })
})
