// SAAS-1-FOLLOWUP-KEYBOARD (2026-05-18) — pure reducers backing
// the arrow-key / Home / End / PageUp / PageDown navigation in
// components/calendar/Grid.tsx. Extracted from the component so
// every key + boundary case can be pinned in a node-env unit suite
// without spinning up jsdom.
//
// See docs/plans/saas-1-followup-keyboard.md §2.2 (key bindings) and
// §3 (test plan items 1–2).

import type { CalendarRow } from '@/lib/calendar/view-model'

// Visible grid band: 35 half-hour rows (06:00 → 23:30 MSK).
// Index 0 = 06:00-06:30, index 34 = 23:00-23:30. Total = 35 cells per column.
export const HALF_HOUR_COUNT = 35
export const MAX_HALF_HOUR = HALF_HOUR_COUNT - 1
export const DAY_COUNT = 7
export const MAX_DAY_IDX = DAY_COUNT - 1

export type ActiveCell = {
  dayIdx: number // 0..6
  halfHour: number // 0..34
}

export type NavKey =
  | 'ArrowUp'
  | 'ArrowDown'
  | 'ArrowLeft'
  | 'ArrowRight'
  | 'Home'
  | 'End'
  | 'PageUp'
  | 'PageDown'

/**
 * Pure reducer — given the current active cell and a navigation key,
 * compute the next active cell. Clamps at the grid edges (does not
 * wrap). No-op when already at the edge in the requested direction.
 */
export function nextActiveCell(active: ActiveCell, key: NavKey): ActiveCell {
  switch (key) {
    case 'ArrowUp':
      return { ...active, halfHour: Math.max(0, active.halfHour - 1) }
    case 'ArrowDown':
      return {
        ...active,
        halfHour: Math.min(MAX_HALF_HOUR, active.halfHour + 1),
      }
    case 'ArrowLeft':
      return { ...active, dayIdx: Math.max(0, active.dayIdx - 1) }
    case 'ArrowRight':
      return { ...active, dayIdx: Math.min(MAX_DAY_IDX, active.dayIdx + 1) }
    case 'Home':
      return { ...active, dayIdx: 0 }
    case 'End':
      return { ...active, dayIdx: MAX_DAY_IDX }
    case 'PageUp':
      return { ...active, halfHour: 0 }
    case 'PageDown':
      return { ...active, halfHour: MAX_HALF_HOUR }
  }
}

/**
 * Resolve which slot (if any) covers a given (ymd, halfHour) cell.
 * Returns the row whose [topHalfHour, topHalfHour + durationHalfHours)
 * span contains `halfHour`. If multiple slots cover the cell (a data
 * invariant says this can't happen, but defensive), the one with the
 * smaller `topPx` wins.
 *
 * Note: half-hour math here uses the same CELL_HEIGHT_PX convention
 * as Grid.tsx, so `topHalfHour = Math.round(topPx / CELL_HEIGHT_PX)`.
 */
export function slotAtCell(
  grouped: Map<string, CalendarRow[]>,
  ymd: string,
  halfHour: number,
  cellHeightPx: number,
): CalendarRow | null {
  const rows = grouped.get(ymd)
  if (!rows || rows.length === 0) return null
  let winner: CalendarRow | null = null
  for (const row of rows) {
    const topHalfHour = Math.round(row.topPx / cellHeightPx)
    const heightHalfHours = Math.max(1, Math.round(row.heightPx / cellHeightPx))
    if (halfHour >= topHalfHour && halfHour < topHalfHour + heightHalfHours) {
      if (winner === null || row.topPx < winner.topPx) {
        winner = row
      }
    }
  }
  return winner
}

/**
 * Map a `KeyboardEvent.key` to a `NavKey` if it is one. Returns null
 * for any other key (so the caller can let the browser handle it).
 */
export function navKeyFromEvent(key: string): NavKey | null {
  switch (key) {
    case 'ArrowUp':
    case 'ArrowDown':
    case 'ArrowLeft':
    case 'ArrowRight':
    case 'Home':
    case 'End':
    case 'PageUp':
    case 'PageDown':
      return key
    default:
      return null
  }
}
