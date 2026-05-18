import { describe, expect, it } from 'vitest'

import {
  CALENDAR_GRID_PX_PER_MIN,
  CALENDAR_GRID_START_HOUR,
} from '@/lib/calendar/dates'
import {
  currentTimeTopPx,
  hourAxisLabels,
  mskYmdNow,
  timeAxisLabels,
} from '@/lib/calendar/view-model'

// SAAS-1 Apple-redesign — pure-function math for hour-only labels +
// current-time indicator + today highlight bucketing. Component-render
// assertions (chip styling, hover, sub-tick visuals) are deferred to
// SAAS-INFRA-1 (jsdom + @testing-library/react not yet in package.json).

describe('SAAS-1 hourAxisLabels', () => {
  it('returns 18 hour-only labels covering 06:00..23:00', () => {
    const labels = hourAxisLabels()
    expect(labels).toHaveLength(23 - CALENDAR_GRID_START_HOUR + 1)
    expect(labels[0]).toBe('06:00')
    expect(labels[labels.length - 1]).toBe('23:00')
    for (const label of labels) {
      expect(label.endsWith(':00')).toBe(true)
    }
  })

  it('does NOT include half-hour entries (those become dotted sub-ticks)', () => {
    const labels = hourAxisLabels()
    for (const label of labels) {
      expect(label.endsWith(':30')).toBe(false)
    }
  })

  it('legacy timeAxisLabels() still works for backward-compat', () => {
    // Drag-paint hit-test math still treats 30 min as a cell. The
    // hour-only switch is visual only; legacy callers (e.g. tests
    // pinning the old behaviour) keep their import working.
    const labels = timeAxisLabels()
    expect(labels.length).toBeGreaterThan(hourAxisLabels().length)
  })
})

describe('SAAS-1 currentTimeTopPx', () => {
  // Helper: build a UTC ms representing a given MSK wall-clock time
  // on an arbitrary date. MSK = UTC+3.
  function mskInstant(h: number, m: number): number {
    return Date.UTC(2026, 4, 18, h - 3, m)
  }

  it('returns null when before MSK 06:00 (start of band)', () => {
    expect(currentTimeTopPx(mskInstant(5, 59))).toBeNull()
    expect(currentTimeTopPx(mskInstant(0, 0))).toBeNull()
  })

  it('returns 0 px exactly at MSK 06:00', () => {
    expect(currentTimeTopPx(mskInstant(6, 0))).toBe(0)
  })

  it('returns 30 min * px-per-min at MSK 06:30', () => {
    expect(currentTimeTopPx(mskInstant(6, 30))).toBe(
      30 * CALENDAR_GRID_PX_PER_MIN,
    )
  })

  it('returns 17h offset at MSK 23:00', () => {
    expect(currentTimeTopPx(mskInstant(23, 0))).toBe(
      17 * 60 * CALENDAR_GRID_PX_PER_MIN,
    )
  })

  it('returns null past MSK 23:30 (end of visible band)', () => {
    expect(currentTimeTopPx(mskInstant(23, 31))).toBeNull()
    expect(currentTimeTopPx(mskInstant(23, 59))).toBeNull()
  })

  it('returns last-valid offset at MSK 23:30', () => {
    expect(currentTimeTopPx(mskInstant(23, 30))).toBe(
      17.5 * 60 * CALENDAR_GRID_PX_PER_MIN,
    )
  })
})

describe('SAAS-1 mskYmdNow (today highlight key)', () => {
  it('formats UTC instant to MSK YYYY-MM-DD', () => {
    // 2026-05-18 12:00 UTC = MSK 15:00 → date stays 2026-05-18
    expect(mskYmdNow(Date.UTC(2026, 4, 18, 12, 0))).toBe('2026-05-18')
  })

  it('rolls over to next MSK day after 21:00 UTC', () => {
    // 2026-05-18 21:00 UTC = MSK 2026-05-19 00:00
    expect(mskYmdNow(Date.UTC(2026, 4, 18, 21, 0))).toBe('2026-05-19')
  })

  it('stays on same MSK day at 20:59 UTC', () => {
    // 2026-05-18 20:59 UTC = MSK 23:59 same day
    expect(mskYmdNow(Date.UTC(2026, 4, 18, 20, 59))).toBe('2026-05-18')
  })
})
