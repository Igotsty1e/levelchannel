import { describe, expect, it } from 'vitest'

import { CALENDAR_GRID_PX_PER_MIN } from '@/lib/calendar/dates'
import type { CalendarSlot } from '@/lib/calendar/types'
import {
  groupSlotsByDay,
  timeAxisLabels,
  weekDayKeys,
} from '@/lib/calendar/view-model'

// Codex round 4 #2 — pinned: 50-min slot block geometry. Block uses
// pixel-precise absolute positioning with PX_PER_MIN constant.

describe('groupSlotsByDay — pixel-precise geometry', () => {
  it('60-min slot at 18:00 MSK → topPx=720, heightPx=90', () => {
    // 18:00 MSK = 15:00 UTC. Grid starts at 06:00 MSK = 03:00 UTC.
    // 12 hours from grid start = 720 minutes. PX_PER_MIN = 1.5 → 1080px.
    const slot: CalendarSlot = {
      kind: 'open',
      id: 'a',
      startAt: new Date(Date.UTC(2026, 4, 11, 15, 0, 0)).toISOString(),
      durationMinutes: 60,
      tariffId: null,
      tariffAmountKopecks: null,
    }
    const grouped = groupSlotsByDay([slot])
    const rows = grouped.get('2026-05-11')!
    expect(rows.length).toBe(1)
    const r = rows[0]
    expect(r.topPx).toBe((18 - 6) * 60 * CALENDAR_GRID_PX_PER_MIN)
    expect(r.heightPx).toBe(60 * CALENDAR_GRID_PX_PER_MIN)
    expect(r.startLabel).toBe('18:00')
    expect(r.endLabel).toBe('19:00')
  })

  it('50-min slot at 18:00 MSK → heightPx = 50 * PX_PER_MIN (fractional row OK)', () => {
    const slot: CalendarSlot = {
      kind: 'open',
      id: 'b',
      startAt: new Date(Date.UTC(2026, 4, 11, 15, 0, 0)).toISOString(),
      durationMinutes: 50,
      tariffId: null,
      tariffAmountKopecks: null,
    }
    const grouped = groupSlotsByDay([slot])
    const r = grouped.get('2026-05-11')![0]
    expect(r.heightPx).toBe(50 * CALENDAR_GRID_PX_PER_MIN)
    expect(r.startLabel).toBe('18:00')
    expect(r.endLabel).toBe('18:50')
  })

  it('30-min slot at 06:00 MSK (top of grid) → topPx=0, heightPx=45', () => {
    const slot: CalendarSlot = {
      kind: 'open',
      id: 'c',
      startAt: new Date(Date.UTC(2026, 4, 11, 3, 0, 0)).toISOString(),
      durationMinutes: 30,
      tariffId: null,
      tariffAmountKopecks: null,
    }
    const r = groupSlotsByDay([slot]).get('2026-05-11')![0]
    expect(r.topPx).toBe(0)
    expect(r.heightPx).toBe(30 * CALENDAR_GRID_PX_PER_MIN)
  })

  it('90-min slot at 22:00 MSK (last allowed start) → endLabel=23:30', () => {
    const slot: CalendarSlot = {
      kind: 'open',
      id: 'd',
      startAt: new Date(Date.UTC(2026, 4, 11, 19, 0, 0)).toISOString(),
      durationMinutes: 90,
      tariffId: null,
      tariffAmountKopecks: null,
    }
    const r = groupSlotsByDay([slot]).get('2026-05-11')![0]
    expect(r.startLabel).toBe('22:00')
    expect(r.endLabel).toBe('23:30')
  })

  it('multiple slots on same day are grouped together', () => {
    const a: CalendarSlot = {
      kind: 'open', id: 'a', startAt: new Date(Date.UTC(2026, 4, 11, 15, 0, 0)).toISOString(),
      durationMinutes: 60, tariffId: null, tariffAmountKopecks: null,
    }
    const b: CalendarSlot = {
      kind: 'open', id: 'b', startAt: new Date(Date.UTC(2026, 4, 11, 17, 0, 0)).toISOString(),
      durationMinutes: 60, tariffId: null, tariffAmountKopecks: null,
    }
    const grouped = groupSlotsByDay([a, b])
    expect(grouped.get('2026-05-11')!.length).toBe(2)
  })

  it('slots on different days go to different buckets', () => {
    const a: CalendarSlot = {
      kind: 'open', id: 'a', startAt: new Date(Date.UTC(2026, 4, 11, 15, 0, 0)).toISOString(),
      durationMinutes: 60, tariffId: null, tariffAmountKopecks: null,
    }
    const b: CalendarSlot = {
      kind: 'open', id: 'b', startAt: new Date(Date.UTC(2026, 4, 12, 15, 0, 0)).toISOString(),
      durationMinutes: 60, tariffId: null, tariffAmountKopecks: null,
    }
    const grouped = groupSlotsByDay([a, b])
    expect(grouped.size).toBe(2)
  })
})

describe('weekDayKeys', () => {
  it('returns 7 consecutive YMD strings starting at fromYmd', () => {
    expect(weekDayKeys('2026-05-11')).toEqual([
      '2026-05-11',
      '2026-05-12',
      '2026-05-13',
      '2026-05-14',
      '2026-05-15',
      '2026-05-16',
      '2026-05-17',
    ])
  })

  it('crosses month boundary correctly', () => {
    const keys = weekDayKeys('2026-04-29')
    expect(keys[0]).toBe('2026-04-29')
    expect(keys[3]).toBe('2026-05-02')
    expect(keys[6]).toBe('2026-05-05')
  })
})

describe('timeAxisLabels', () => {
  it('returns labels from 06:00 through 23:30 in 30-min increments', () => {
    const labels = timeAxisLabels()
    expect(labels[0]).toBe('06:00')
    expect(labels[1]).toBe('06:30')
    expect(labels.includes('22:00')).toBe(true)
    expect(labels.includes('23:00')).toBe(true)
    expect(labels.includes('23:30')).toBe(true)
  })
})
