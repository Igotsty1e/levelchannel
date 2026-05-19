// SAAS-1-FOLLOWUP-KEYBOARD — pure-reducer unit tests for the
// keyboard nav helpers in lib/calendar/grid-keyboard.ts.
// Pins every clamp boundary + the slot-resolution invariants so the
// component-level RTL suite can focus on DOM-focus side-effects.

import { describe, expect, it } from 'vitest'

import {
  MAX_DAY_IDX,
  MAX_HALF_HOUR,
  nextActiveCell,
  slotAtCell,
  navKeyFromEvent,
} from '@/lib/calendar/grid-keyboard'
import type { CalendarRow } from '@/lib/calendar/view-model'
import type { CalendarSlot } from '@/lib/calendar/types'

const CELL = 30 // 30 minutes × 1 px/min

function row(topPx: number, heightPx: number): CalendarRow {
  const slot: CalendarSlot = {
    kind: 'open',
    id: `s-${topPx}`,
    startAt: '2026-05-20T11:00:00.000Z',
    durationMinutes: heightPx,
    tariffId: null,
    tariffAmountKopecks: null,
  }
  return {
    slot,
    dayYmd: '2026-05-20',
    topPx,
    heightPx,
    startLabel: '11:00',
    endLabel: '12:00',
  }
}

describe('nextActiveCell — clamp at edges', () => {
  it('ArrowUp at top is a no-op', () => {
    expect(nextActiveCell({ dayIdx: 3, halfHour: 0 }, 'ArrowUp')).toEqual({
      dayIdx: 3,
      halfHour: 0,
    })
  })
  it('ArrowUp decrements halfHour otherwise', () => {
    expect(nextActiveCell({ dayIdx: 3, halfHour: 5 }, 'ArrowUp')).toEqual({
      dayIdx: 3,
      halfHour: 4,
    })
  })
  it('ArrowDown at bottom is a no-op', () => {
    expect(
      nextActiveCell({ dayIdx: 3, halfHour: MAX_HALF_HOUR }, 'ArrowDown'),
    ).toEqual({ dayIdx: 3, halfHour: MAX_HALF_HOUR })
  })
  it('ArrowDown increments halfHour otherwise', () => {
    expect(nextActiveCell({ dayIdx: 3, halfHour: 5 }, 'ArrowDown')).toEqual({
      dayIdx: 3,
      halfHour: 6,
    })
  })
  it('ArrowLeft at first day is a no-op', () => {
    expect(nextActiveCell({ dayIdx: 0, halfHour: 6 }, 'ArrowLeft')).toEqual({
      dayIdx: 0,
      halfHour: 6,
    })
  })
  it('ArrowLeft decrements dayIdx otherwise', () => {
    expect(nextActiveCell({ dayIdx: 3, halfHour: 6 }, 'ArrowLeft')).toEqual({
      dayIdx: 2,
      halfHour: 6,
    })
  })
  it('ArrowRight at last day is a no-op', () => {
    expect(
      nextActiveCell({ dayIdx: MAX_DAY_IDX, halfHour: 6 }, 'ArrowRight'),
    ).toEqual({ dayIdx: MAX_DAY_IDX, halfHour: 6 })
  })
  it('ArrowRight increments dayIdx otherwise', () => {
    expect(nextActiveCell({ dayIdx: 3, halfHour: 6 }, 'ArrowRight')).toEqual({
      dayIdx: 4,
      halfHour: 6,
    })
  })
  it('Home jumps to first day (column unchanged)', () => {
    expect(nextActiveCell({ dayIdx: 5, halfHour: 12 }, 'Home')).toEqual({
      dayIdx: 0,
      halfHour: 12,
    })
  })
  it('End jumps to last day', () => {
    expect(nextActiveCell({ dayIdx: 1, halfHour: 12 }, 'End')).toEqual({
      dayIdx: MAX_DAY_IDX,
      halfHour: 12,
    })
  })
  it('PageUp jumps to halfHour 0', () => {
    expect(nextActiveCell({ dayIdx: 2, halfHour: 20 }, 'PageUp')).toEqual({
      dayIdx: 2,
      halfHour: 0,
    })
  })
  it('PageDown jumps to MAX_HALF_HOUR', () => {
    expect(nextActiveCell({ dayIdx: 2, halfHour: 5 }, 'PageDown')).toEqual({
      dayIdx: 2,
      halfHour: MAX_HALF_HOUR,
    })
  })
})

describe('slotAtCell — empty / inside / boundary cases', () => {
  it('returns null on day with no slots', () => {
    const grouped = new Map<string, CalendarRow[]>()
    expect(slotAtCell(grouped, '2026-05-20', 6, CELL)).toBeNull()
  })
  it('returns null on cell outside any slot', () => {
    const grouped = new Map([
      ['2026-05-20', [row(6 * CELL, 2 * CELL)]], // slot at halfHour 6..7
    ])
    expect(slotAtCell(grouped, '2026-05-20', 5, CELL)).toBeNull()
    expect(slotAtCell(grouped, '2026-05-20', 8, CELL)).toBeNull()
  })
  it('returns the slot at the top half-hour', () => {
    const r = row(6 * CELL, 2 * CELL)
    const grouped = new Map([['2026-05-20', [r]]])
    expect(slotAtCell(grouped, '2026-05-20', 6, CELL)).toBe(r)
  })
  it('returns the slot at the last covered half-hour', () => {
    const r = row(6 * CELL, 2 * CELL) // covers 6..7 inclusive
    const grouped = new Map([['2026-05-20', [r]]])
    expect(slotAtCell(grouped, '2026-05-20', 7, CELL)).toBe(r)
  })
  it('returns null just past the slot end', () => {
    const r = row(6 * CELL, 2 * CELL) // covers 6..7
    const grouped = new Map([['2026-05-20', [r]]])
    expect(slotAtCell(grouped, '2026-05-20', 8, CELL)).toBeNull()
  })
  it('prefers the slot with the smaller topPx when overlapping (defensive)', () => {
    const top = row(6 * CELL, 4 * CELL)
    const bottom = row(8 * CELL, 2 * CELL)
    const grouped = new Map([['2026-05-20', [bottom, top]]])
    expect(slotAtCell(grouped, '2026-05-20', 9, CELL)).toBe(top)
  })
})

describe('navKeyFromEvent', () => {
  it('returns the key for arrow / Home / End / Page*', () => {
    expect(navKeyFromEvent('ArrowUp')).toBe('ArrowUp')
    expect(navKeyFromEvent('ArrowDown')).toBe('ArrowDown')
    expect(navKeyFromEvent('ArrowLeft')).toBe('ArrowLeft')
    expect(navKeyFromEvent('ArrowRight')).toBe('ArrowRight')
    expect(navKeyFromEvent('Home')).toBe('Home')
    expect(navKeyFromEvent('End')).toBe('End')
    expect(navKeyFromEvent('PageUp')).toBe('PageUp')
    expect(navKeyFromEvent('PageDown')).toBe('PageDown')
  })
  it('returns null for non-navigation keys', () => {
    expect(navKeyFromEvent('Enter')).toBeNull()
    expect(navKeyFromEvent(' ')).toBeNull()
    expect(navKeyFromEvent('a')).toBeNull()
    expect(navKeyFromEvent('Tab')).toBeNull()
  })
})
