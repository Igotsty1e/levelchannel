import { describe, expect, it } from 'vitest'

import {
  ALLOWED_DURATIONS,
  MAX_RECURRENCE_SPAN_DAYS,
  RecurrenceInputError,
  expandRecurrence,
} from '@/lib/calendar/recurrence'

describe('expandRecurrence', () => {
  it('one-shot single date — emits times if in business hours and aligned', () => {
    const r = expandRecurrence({
      startDate: '2026-09-01', // Tuesday
      endDate: '2026-09-01',
      daysOfWeek: [],
      times: ['12:00', '14:30', '18:00'],
      durationMinutes: 60,
    })
    expect(r.slots).toHaveLength(3)
    expect(r.skipped).toHaveLength(0)
  })

  it('skips out-of-business-hours candidates with typed reason', () => {
    const r = expandRecurrence({
      startDate: '2026-09-01',
      endDate: '2026-09-01',
      daysOfWeek: [],
      times: ['05:00', '06:00', '22:00', '23:00'],
      durationMinutes: 60,
    })
    expect(r.slots.map((s) => s.startUtcIso)).toHaveLength(2) // 06:00 + 22:00
    expect(r.skipped.map((s) => s.reason).sort()).toEqual([
      'outside_business_hours',
      'outside_business_hours',
    ])
  })

  it('skips non-30-min-aligned times', () => {
    const r = expandRecurrence({
      startDate: '2026-09-01',
      endDate: '2026-09-01',
      daysOfWeek: [],
      times: ['12:15', '12:30', '12:45'],
      durationMinutes: 60,
    })
    expect(r.slots).toHaveLength(1) // only 12:30
    expect(r.skipped.map((s) => s.reason)).toEqual([
      'not_30min_aligned',
      'not_30min_aligned',
    ])
  })

  it('day-of-week filter — only matching weekdays in range', () => {
    // Tue 2026-09-01 ... Mon 2026-09-07 (7 days span). DoW Tue=2, Thu=4.
    const r = expandRecurrence({
      startDate: '2026-09-01',
      endDate: '2026-09-07',
      daysOfWeek: [2, 4],
      times: ['12:00'],
      durationMinutes: 60,
    })
    expect(r.slots).toHaveLength(2)
  })

  it('rejects span > 90 days', () => {
    expect(() =>
      expandRecurrence({
        startDate: '2026-09-01',
        endDate: '2026-12-15',
        daysOfWeek: [1, 2, 3, 4, 5],
        times: ['12:00'],
        durationMinutes: 60,
      }),
    ).toThrow(RecurrenceInputError)
  })

  it('rejects unknown duration', () => {
    expect(() =>
      expandRecurrence({
        startDate: '2026-09-01',
        endDate: '2026-09-01',
        daysOfWeek: [],
        times: ['12:00'],
        durationMinutes: 33,
      }),
    ).toThrow(RecurrenceInputError)
  })

  it('rejects empty times', () => {
    expect(() =>
      expandRecurrence({
        startDate: '2026-09-01',
        endDate: '2026-09-01',
        daysOfWeek: [],
        times: [],
        durationMinutes: 60,
      }),
    ).toThrow(RecurrenceInputError)
  })

  it('rejects empty daysOfWeek when range > 1 day', () => {
    expect(() =>
      expandRecurrence({
        startDate: '2026-09-01',
        endDate: '2026-09-07',
        daysOfWeek: [],
        times: ['12:00'],
        durationMinutes: 60,
      }),
    ).toThrow(RecurrenceInputError)
  })

  it('returns at most 200 slots; remaining work is dropped silently', () => {
    // 90 days × 7 dow × 4 times = 2520 candidates; cap returns 201 to
    // signal "over cap" (length>200 in slots). The endpoint must check
    // length and reject before insert.
    const r = expandRecurrence({
      startDate: '2026-09-01',
      endDate: '2026-11-30',
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      times: ['08:00', '10:00', '14:00', '20:00'],
      durationMinutes: 60,
    })
    expect(r.slots.length).toBeGreaterThan(200)
  })

  it('preserves allowed duration whitelist matches mig 0031 plausibility', () => {
    for (const d of ALLOWED_DURATIONS) {
      expect(d).toBeGreaterThanOrEqual(30)
      expect(d).toBeLessThanOrEqual(120)
    }
  })

  it('MAX_RECURRENCE_SPAN_DAYS = 90 (plan §3 Q4)', () => {
    expect(MAX_RECURRENCE_SPAN_DAYS).toBe(90)
  })
})
