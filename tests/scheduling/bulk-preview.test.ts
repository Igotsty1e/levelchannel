import { describe, expect, it } from 'vitest'

import { bulkGeneratePreview } from '@/lib/scheduling/slots'

const ANCHOR_PAST = '2020-01-06' // Monday in MSK
const FAR_FUTURE_DATE_OFFSET_WEEKS = 52 * 5 // 5 years out, safely future

function nextMondayYmd(weeksOut: number): string {
  // Build a Monday N weeks from today in Europe/Moscow.
  const tz = 'Europe/Moscow'
  const now = new Date()
  // Find the next Monday from today; accept "today is Monday".
  const dtfShort = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short',
  })
  const map: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  }
  const todayWeekday = map[dtfShort.format(now)] ?? 0
  const daysUntilMon = (1 - todayWeekday + 7) % 7
  const targetMs =
    now.getTime() +
    (daysUntilMon + weeksOut * 7) * 86_400_000
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  return dtf.format(new Date(targetMs))
}

describe('bulkGeneratePreview', () => {
  it('rejects empty weekdays', () => {
    const r = bulkGeneratePreview({
      weekdays: [],
      startTime: '18:00',
      startDate: nextMondayYmd(1),
      weeks: 1,
      durationMinutes: 60,
      timezone: 'Europe/Moscow',
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error.field).toBe('weekdays')
    }
  })

  it('rejects malformed start time', () => {
    const r = bulkGeneratePreview({
      weekdays: [1],
      startTime: '25:00',
      startDate: nextMondayYmd(1),
      weeks: 1,
      durationMinutes: 60,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.field).toBe('startTime')
  })

  it('rejects out-of-band weeks', () => {
    const r = bulkGeneratePreview({
      weekdays: [1],
      startTime: '18:00',
      startDate: nextMondayYmd(1),
      weeks: 100,
      durationMinutes: 60,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.field).toBe('weeks')
  })

  it('generates one slot per matching weekday over N weeks', () => {
    const r = bulkGeneratePreview({
      weekdays: [1], // Monday only
      startTime: '18:00',
      startDate: nextMondayYmd(1),
      weeks: 4,
      durationMinutes: 60,
      timezone: 'Europe/Moscow',
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.slots.length).toBe(4)
      // All times are 18:00 in Europe/Moscow → 15:00 UTC year-round
      // (Russia has no DST since 2014).
      for (const s of r.slots) {
        expect(s.startAt.endsWith('T15:00:00.000Z')).toBe(true)
      }
    }
  })

  it('generates multiple weekdays per week', () => {
    const r = bulkGeneratePreview({
      weekdays: [1, 3, 5], // Mon, Wed, Fri
      startTime: '18:00',
      startDate: nextMondayYmd(1),
      weeks: 2,
      durationMinutes: 60,
      timezone: 'Europe/Moscow',
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.slots.length).toBe(6)
    }
  })

  it('honours skipDates', () => {
    const monday = nextMondayYmd(1)
    const r = bulkGeneratePreview({
      weekdays: [1],
      startTime: '18:00',
      startDate: monday,
      weeks: 4,
      durationMinutes: 60,
      skipDates: [monday], // skip the very first occurrence
      timezone: 'Europe/Moscow',
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.slots.length).toBe(3)
      expect(r.slots[0].date).not.toBe(monday)
    }
  })

  it('silently drops past slots when start date is in the past', () => {
    const r = bulkGeneratePreview({
      weekdays: [1],
      startTime: '18:00',
      startDate: ANCHOR_PAST,
      weeks: 2,
      durationMinutes: 60,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      // Anchor is 2020 — every generated date is in the past, all dropped.
      expect(r.slots.length).toBe(0)
    }
  })
})
