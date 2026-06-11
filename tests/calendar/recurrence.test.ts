import { describe, expect, it } from 'vitest'

import {
  MAX_RECURRENCE_SPAN_DAYS,
  RECURRENCE_DURATION_MAX,
  RECURRENCE_DURATION_MIN,
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

  it('rejects out-of-range duration (2026-06-11: was whitelist [30,45,50,60,75,90,120], now range [15,180])', () => {
    expect(() =>
      expandRecurrence({
        startDate: '2026-09-01',
        endDate: '2026-09-01',
        daysOfWeek: [],
        times: ['12:00'],
        durationMinutes: 14,
      }),
    ).toThrow(RecurrenceInputError)
    expect(() =>
      expandRecurrence({
        startDate: '2026-09-01',
        endDate: '2026-09-01',
        daysOfWeek: [],
        times: ['12:00'],
        durationMinutes: 181,
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

  it('duration range [15, 180] accepted; out-of-range rejected (2026-06-11 minute-duration epic)', () => {
    expect(RECURRENCE_DURATION_MIN).toBe(15)
    expect(RECURRENCE_DURATION_MAX).toBe(180)
    // 47-min non-preset value works now
    const r = expandRecurrence({
      startDate: '2026-09-01',
      endDate: '2026-09-01',
      daysOfWeek: [],
      times: ['10:00'],
      durationMinutes: 47,
    })
    expect(r.slots).toHaveLength(1)
    expect(r.slots[0].durationMinutes).toBe(47)
    // out-of-range rejected
    expect(() =>
      expandRecurrence({
        startDate: '2026-09-01',
        endDate: '2026-09-01',
        daysOfWeek: [],
        times: ['10:00'],
        durationMinutes: 14,
      }),
    ).toThrow(RecurrenceInputError)
    expect(() =>
      expandRecurrence({
        startDate: '2026-09-01',
        endDate: '2026-09-01',
        daysOfWeek: [],
        times: ['10:00'],
        durationMinutes: 181,
      }),
    ).toThrow(RecurrenceInputError)
  })

  it('MAX_RECURRENCE_SPAN_DAYS = 90 (plan §3 Q4)', () => {
    expect(MAX_RECURRENCE_SPAN_DAYS).toBe(90)
  })
})
