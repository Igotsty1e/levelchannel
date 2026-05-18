// SAAS-1 5.F (2026-05-18) — drag-math seam extracted to pure
// functions for node-env test coverage.
//
// docs/plans/calendar-apple-redesign.md §5.F. Both
// components/calendar/Grid.tsx (halfHourFromOffset) and
// components/calendar/SlotCalendar.tsx (findCellAt) embedded their
// pointer-to-cell math inline; round-1 paranoia BLOCKER#3 flagged
// the missing test coverage because a 30-min pointer-mapping bug
// here silently emits the wrong slot to bulkCreate / slot.move.
// Extracting them lets us pin every boundary case without spinning
// up jsdom.

import { CALENDAR_GRID_PX_PER_MIN } from '@/lib/calendar/dates'

// Half-hour CELL is the hit-test unit. The Apple-style hour grid
// (#289) is presentation-only — the underlying 30-min boundary is
// what drag-paint + drag-move snap to.
export const CELL_HEIGHT_PX = 30 * CALENDAR_GRID_PX_PER_MIN
// 35 half-hour cells = 17.5 hours = 06:00..23:30 visible band.
export const MAX_HALF_HOUR_INDEX = 35

/**
 * Map a vertical pixel offset within a day column to a half-hour
 * index in [0..35]. Negative offsets clamp to 0; offsets past the
 * visible band clamp to 35.
 *
 * Used by Grid.tsx for the column-level mouse handlers.
 */
export function halfHourFromOffset(offsetY: number): number {
  const cell = Math.floor(offsetY / CELL_HEIGHT_PX)
  if (!Number.isFinite(cell) || cell < 0) return 0
  if (cell > MAX_HALF_HOUR_INDEX) return MAX_HALF_HOUR_INDEX
  return cell
}

export type DayColumnRect = {
  ymd: string
  left: number
  right: number
  top: number
  bottom: number
}

/**
 * Resolve a viewport-relative pointer (clientX, clientY) to a
 * (ymd, halfHour) cell. Walks the provided day-column rects in
 * order; the first matching rect wins. Returns null if the pointer
 * is outside every column.
 *
 * Pure function — the live component reads `getBoundingClientRect()`
 * once per day and threads the result here so tests can replay
 * deterministic geometry.
 */
export function findCellAt(
  clientX: number,
  clientY: number,
  columns: ReadonlyArray<DayColumnRect>,
): { ymd: string; halfHour: number } | null {
  for (const col of columns) {
    if (
      clientX >= col.left &&
      clientX < col.right &&
      clientY >= col.top &&
      clientY < col.bottom
    ) {
      const offsetY = clientY - col.top
      const halfHour = halfHourFromOffset(offsetY)
      return { ymd: col.ymd, halfHour }
    }
  }
  return null
}
