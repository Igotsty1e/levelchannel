import { describe, expect, it } from 'vitest'

import {
  formatMskHhmm,
  formatMskYmd,
  isValidYmd,
  mskMidnightUtc,
  mskOffsetMinutes,
  mskWallToUtcIso,
  ymdDaysDiff,
} from '@/lib/calendar/dates'
import { pickActiveCalendarRole } from '@/lib/calendar/types'

describe('mskOffsetMinutes', () => {
  it('returns +180 for any UTC instant (MSK = UTC+3 year-round, no DST since 2014)', () => {
    expect(mskOffsetMinutes(Date.UTC(2026, 0, 15, 12, 0, 0))).toBe(180)
    expect(mskOffsetMinutes(Date.UTC(2026, 6, 15, 12, 0, 0))).toBe(180)
    expect(mskOffsetMinutes(Date.UTC(2024, 1, 29, 12, 0, 0))).toBe(180) // leap day
    expect(mskOffsetMinutes(Date.UTC(2026, 11, 31, 23, 59, 0))).toBe(180) // year boundary
  })
})

describe('mskWallToUtcIso', () => {
  it('"2026-05-10" 18:00 MSK → "2026-05-10T15:00:00.000Z"', () => {
    expect(mskWallToUtcIso('2026-05-10', '18:00')).toBe('2026-05-10T15:00:00.000Z')
  })

  it('"2026-05-10" 00:00 MSK → "2026-05-09T21:00:00.000Z"', () => {
    expect(mskWallToUtcIso('2026-05-10', '00:00')).toBe('2026-05-09T21:00:00.000Z')
  })

  it('returns null on malformed date', () => {
    expect(mskWallToUtcIso('2026-13-01', '12:00')).toBeNull()
    expect(mskWallToUtcIso('not-a-date', '12:00')).toBeNull()
    expect(mskWallToUtcIso('2026-05-10T12:00:00Z', '12:00')).toBeNull()
  })

  it('returns null on malformed time', () => {
    expect(mskWallToUtcIso('2026-05-10', '25:00')).toBeNull()
    expect(mskWallToUtcIso('2026-05-10', '12:60')).toBeNull()
    expect(mskWallToUtcIso('2026-05-10', 'noon')).toBeNull()
  })
})

describe('mskMidnightUtc', () => {
  it('"2026-05-10" → "2026-05-09T21:00:00.000Z"', () => {
    expect(mskMidnightUtc('2026-05-10')).toBe('2026-05-09T21:00:00.000Z')
  })

  it('year boundary: "2026-12-31" → "2026-12-30T21:00:00.000Z"', () => {
    expect(mskMidnightUtc('2026-12-31')).toBe('2026-12-30T21:00:00.000Z')
  })

  it('leap day: "2024-02-29" → "2024-02-28T21:00:00.000Z"', () => {
    expect(mskMidnightUtc('2024-02-29')).toBe('2024-02-28T21:00:00.000Z')
  })
})

describe('isValidYmd', () => {
  it('accepts canonical YYYY-MM-DD', () => {
    expect(isValidYmd('2026-05-10')).toBe(true)
    expect(isValidYmd('2024-02-29')).toBe(true) // leap year
    expect(isValidYmd('2026-12-31')).toBe(true)
  })

  it('rejects non-canonical formats', () => {
    expect(isValidYmd('2026-5-10')).toBe(false)
    expect(isValidYmd('2026/05/10')).toBe(false)
    expect(isValidYmd('2026-05-10T00:00:00Z')).toBe(false)
    expect(isValidYmd('05-10-2026')).toBe(false)
    expect(isValidYmd('yesterday')).toBe(false)
    expect(isValidYmd('')).toBe(false)
  })

  it('rejects invalid dates', () => {
    expect(isValidYmd('2026-13-01')).toBe(false) // month 13
    expect(isValidYmd('2026-02-30')).toBe(false) // Feb 30
    expect(isValidYmd('2025-02-29')).toBe(false) // non-leap year
    expect(isValidYmd('1899-12-31')).toBe(false) // out of range
    expect(isValidYmd('2101-01-01')).toBe(false) // out of range
  })
})

describe('ymdDaysDiff', () => {
  it('exact 7 days', () => {
    expect(ymdDaysDiff('2026-05-10', '2026-05-17')).toBe(7)
  })

  it('zero days', () => {
    expect(ymdDaysDiff('2026-05-10', '2026-05-10')).toBe(0)
  })

  it('negative', () => {
    expect(ymdDaysDiff('2026-05-17', '2026-05-10')).toBe(-7)
  })

  it('returns null on bad input', () => {
    expect(ymdDaysDiff('bad', '2026-05-10')).toBeNull()
    expect(ymdDaysDiff('2026-05-10', 'bad')).toBeNull()
  })

  it('crosses month/year boundaries correctly', () => {
    expect(ymdDaysDiff('2026-12-25', '2027-01-01')).toBe(7)
  })
})

describe('formatMskHhmm', () => {
  it('UTC 15:00 → "18:00" MSK', () => {
    expect(formatMskHhmm(Date.UTC(2026, 4, 10, 15, 0, 0))).toBe('18:00')
  })

  it('UTC 21:00 → "00:00" MSK (next day)', () => {
    expect(formatMskHhmm(Date.UTC(2026, 4, 10, 21, 0, 0))).toBe('00:00')
  })

  it('pads single digits', () => {
    expect(formatMskHhmm(Date.UTC(2026, 4, 10, 4, 5, 0))).toBe('07:05')
  })
})

describe('formatMskYmd', () => {
  it('renders MSK date', () => {
    expect(formatMskYmd(Date.UTC(2026, 4, 10, 15, 0, 0))).toBe('2026-05-10')
  })

  it('handles MSK day rollover from UTC', () => {
    // UTC 21:30 on May 10 = MSK 00:30 on May 11
    expect(formatMskYmd(Date.UTC(2026, 4, 10, 21, 30, 0))).toBe('2026-05-11')
  })
})

describe('pickActiveCalendarRole', () => {
  it('admin precedence wins over teacher', () => {
    expect(pickActiveCalendarRole(['admin', 'teacher'])).toBe('admin')
  })

  it('admin precedence wins over student', () => {
    expect(pickActiveCalendarRole(['admin', 'student'])).toBe('admin')
  })

  it('teacher precedence wins over student', () => {
    expect(pickActiveCalendarRole(['teacher', 'student'])).toBe('teacher')
  })

  it('learner-only', () => {
    expect(pickActiveCalendarRole(['student'])).toBe('learner')
  })

  it('admin-only', () => {
    expect(pickActiveCalendarRole(['admin'])).toBe('admin')
  })

  it('teacher-only', () => {
    expect(pickActiveCalendarRole(['teacher'])).toBe('teacher')
  })

  it('empty role list → learner (deny-list archetype: no admin/teacher = learner)', () => {
    expect(pickActiveCalendarRole([])).toBe('learner')
  })

  it('unrecognized role → learner (deny-list archetype)', () => {
    expect(pickActiveCalendarRole(['unknown_role'])).toBe('learner')
  })
})
