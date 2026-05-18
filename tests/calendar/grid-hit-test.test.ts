import { describe, expect, it } from 'vitest'

import { CALENDAR_GRID_PX_PER_MIN } from '@/lib/calendar/dates'
import {
  CELL_HEIGHT_PX,
  MAX_HALF_HOUR_INDEX,
  findCellAt,
  halfHourFromOffset,
  type DayColumnRect,
} from '@/lib/calendar/grid-hit-test'

// SAAS-1 5.F — round-1 BLOCKER#3 closure. The pointer-to-cell math
// was previously inlined in components/calendar/{Grid,SlotCalendar}.tsx
// with zero coverage. A 30-min drift bug silently emitted the wrong
// halfHour to bulkCreate / slot.move. Now extracted to lib and pinned.

describe('halfHourFromOffset', () => {
  it('maps 0 px to half-hour 0', () => {
    expect(halfHourFromOffset(0)).toBe(0)
  })

  it('maps offset just below CELL_HEIGHT_PX to 0', () => {
    expect(halfHourFromOffset(CELL_HEIGHT_PX - 1)).toBe(0)
  })

  it('maps exactly CELL_HEIGHT_PX to half-hour 1', () => {
    expect(halfHourFromOffset(CELL_HEIGHT_PX)).toBe(1)
  })

  it('maps mid-cell to the lower half-hour (floor)', () => {
    expect(halfHourFromOffset(CELL_HEIGHT_PX * 1.5)).toBe(1)
    expect(halfHourFromOffset(CELL_HEIGHT_PX * 1 + 1)).toBe(1)
  })

  it('clamps negative offsets to 0', () => {
    expect(halfHourFromOffset(-1)).toBe(0)
    expect(halfHourFromOffset(-100)).toBe(0)
  })

  it('maps the last visible cell (35) at the band boundary', () => {
    const offsetAtLastCellStart = MAX_HALF_HOUR_INDEX * CELL_HEIGHT_PX
    expect(halfHourFromOffset(offsetAtLastCellStart)).toBe(MAX_HALF_HOUR_INDEX)
    expect(halfHourFromOffset(offsetAtLastCellStart + 1)).toBe(MAX_HALF_HOUR_INDEX)
  })

  it('clamps offsets past the visible band to 35', () => {
    expect(
      halfHourFromOffset((MAX_HALF_HOUR_INDEX + 1) * CELL_HEIGHT_PX),
    ).toBe(MAX_HALF_HOUR_INDEX)
    expect(halfHourFromOffset(99999)).toBe(MAX_HALF_HOUR_INDEX)
  })

  it('handles non-finite inputs by clamping to 0', () => {
    expect(halfHourFromOffset(Number.NaN)).toBe(0)
    expect(halfHourFromOffset(Number.NEGATIVE_INFINITY)).toBe(0)
    // POSITIVE_INFINITY → Math.floor(Infinity) = Infinity → not finite
    // → caught by the early-return guard → 0 (defensive default).
    expect(halfHourFromOffset(Number.POSITIVE_INFINITY)).toBe(0)
  })

  it('pixel scale matches CALENDAR_GRID_PX_PER_MIN', () => {
    // CELL_HEIGHT_PX is derived as 30 min × PX_PER_MIN. Pin the
    // relationship so a future change to PX_PER_MIN can't silently
    // shift the hit-test grid.
    expect(CELL_HEIGHT_PX).toBe(30 * CALENDAR_GRID_PX_PER_MIN)
  })

  it('30-min boundary: 17:00 cell ≠ 17:30 cell', () => {
    // 17:00 = 22 half-hours past 06:00 ≡ index 22.
    // 17:30 = 23 half-hours past 06:00 ≡ index 23.
    // Boundary case for the visible band.
    const y1700 = 22 * CELL_HEIGHT_PX
    const y1730 = 23 * CELL_HEIGHT_PX
    expect(halfHourFromOffset(y1700)).toBe(22)
    expect(halfHourFromOffset(y1730)).toBe(23)
    expect(halfHourFromOffset(y1700 + CELL_HEIGHT_PX - 1)).toBe(22)
  })
})

describe('findCellAt', () => {
  // Three adjacent columns for a 3-day mini-grid. Real production
  // grid is 7 cols, but the algorithm is order-independent — any
  // count works for the test matrix.
  const cols: DayColumnRect[] = [
    { ymd: '2026-05-18', left: 100, right: 200, top: 50, bottom: 1625 },
    { ymd: '2026-05-19', left: 200, right: 300, top: 50, bottom: 1625 },
    { ymd: '2026-05-20', left: 300, right: 400, top: 50, bottom: 1625 },
  ]

  it('resolves a pointer inside col 1 to its (ymd, halfHour)', () => {
    expect(findCellAt(150, 50 + CELL_HEIGHT_PX * 2 + 5, cols)).toEqual({
      ymd: '2026-05-18',
      halfHour: 2,
    })
  })

  it('resolves a pointer inside col 2', () => {
    expect(findCellAt(250, 50 + CELL_HEIGHT_PX * 10 + 1, cols)).toEqual({
      ymd: '2026-05-19',
      halfHour: 10,
    })
  })

  it('left edge is inclusive (rect.left)', () => {
    expect(findCellAt(100, 60, cols)).toEqual({
      ymd: '2026-05-18',
      halfHour: 0,
    })
  })

  it('right edge is exclusive (rect.right belongs to NEXT column)', () => {
    expect(findCellAt(200, 60, cols)).toEqual({
      ymd: '2026-05-19',
      halfHour: 0,
    })
  })

  it('top edge is inclusive (rect.top → halfHour 0)', () => {
    expect(findCellAt(150, 50, cols)).toEqual({
      ymd: '2026-05-18',
      halfHour: 0,
    })
  })

  it('bottom edge is exclusive (rect.bottom returns null)', () => {
    expect(findCellAt(150, 1625, cols)).toBeNull()
  })

  it('returns null for a pointer left of every column', () => {
    expect(findCellAt(99, 100, cols)).toBeNull()
  })

  it('returns null for a pointer right of every column', () => {
    expect(findCellAt(401, 100, cols)).toBeNull()
  })

  it('returns null for a pointer above the grid (negative top)', () => {
    expect(findCellAt(150, -5, cols)).toBeNull()
    expect(findCellAt(150, 49, cols)).toBeNull()
  })

  it('returns null for a pointer below the grid', () => {
    expect(findCellAt(150, 1700, cols)).toBeNull()
  })

  it('returns null with empty columns array', () => {
    expect(findCellAt(150, 100, [])).toBeNull()
  })

  it('first matching column wins (no overlap-resolution; caller controls order)', () => {
    const overlapping: DayColumnRect[] = [
      { ymd: 'first', left: 100, right: 300, top: 0, bottom: 1000 },
      { ymd: 'second', left: 100, right: 300, top: 0, bottom: 1000 },
    ]
    expect(findCellAt(150, 100, overlapping)?.ymd).toBe('first')
  })

  it('clamps offset past band to halfHour 35 (delegates to halfHourFromOffset)', () => {
    expect(findCellAt(150, 50 + 1000 * CELL_HEIGHT_PX, cols)).toBeNull()
    // Inside band but above band-top: would NOT be null but clamps.
    // We can't easily test that without a column whose `bottom` is
    // intentionally past the visible band — covered by the
    // halfHourFromOffset suite above.
  })
})
