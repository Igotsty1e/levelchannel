// Wave A — DTO → UI view-model normalization. Takes raw
// `CalendarResponse` from the server and projects it to a per-day-
// column array of slot rows ready for the grid's pixel-precise
// absolute positioning math.

import {
  CALENDAR_GRID_PX_PER_MIN,
  CALENDAR_GRID_START_HOUR,
  formatMskHhmm,
  formatMskYmd,
} from './dates'
import type { CalendarSlot } from './types'

// One row in the grid. `topPx` and `heightPx` are derived in this
// module so the rendering layer never does its own time math.
export type CalendarRow = {
  slot: CalendarSlot
  // Derived layout
  dayYmd: string // 'YYYY-MM-DD' MSK — bucket key
  topPx: number // offset from grid top
  heightPx: number
  startLabel: string // 'HH:MM' MSK
  endLabel: string
}

// Group calendar response into a per-day-column map (key = MSK date).
// Each value is an array of CalendarRow for that day.
export function groupSlotsByDay(
  slots: ReadonlyArray<CalendarSlot>,
): Map<string, CalendarRow[]> {
  const out = new Map<string, CalendarRow[]>()
  for (const slot of slots) {
    const startMs = Date.parse(slot.startAt)
    const endMs = startMs + slot.durationMinutes * 60_000
    const dayYmd = formatMskYmd(startMs)
    const startMinutesFromMsk6Am = mskMinutesFromGridStart(startMs)
    const topPx = startMinutesFromMsk6Am * CALENDAR_GRID_PX_PER_MIN
    const heightPx = slot.durationMinutes * CALENDAR_GRID_PX_PER_MIN
    const startLabel = formatMskHhmm(startMs)
    const endLabel = formatMskHhmm(endMs)
    const row: CalendarRow = {
      slot,
      dayYmd,
      topPx,
      heightPx,
      startLabel,
      endLabel,
    }
    const list = out.get(dayYmd) ?? []
    list.push(row)
    out.set(dayYmd, list)
  }
  return out
}

// Minutes from grid start (06:00 MSK) for a UTC instant.
function mskMinutesFromGridStart(utcMs: number): number {
  // Get MSK hour + minute via Intl.DateTimeFormat.
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Moscow',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const parts = dtf.formatToParts(new Date(utcMs))
  let h = 0
  let m = 0
  for (const p of parts) {
    if (p.type === 'hour') h = Number(p.value)
    if (p.type === 'minute') m = Number(p.value)
  }
  if (h === 24) h = 0
  return (h - CALENDAR_GRID_START_HOUR) * 60 + m
}

// Generate the array of YMD strings for a 7-day week starting at `fromYmd`.
export function weekDayKeys(fromYmd: string): string[] {
  const out: string[] = []
  const [y, mo, d] = fromYmd.split('-').map(Number)
  for (let i = 0; i < 7; i += 1) {
    const date = new Date(Date.UTC(y, mo - 1, d + i))
    out.push(date.toISOString().slice(0, 10))
  }
  return out
}

// Generate the array of HH:MM time labels for the grid rows.
export function timeAxisLabels(): string[] {
  const out: string[] = []
  for (let h = CALENDAR_GRID_START_HOUR; h <= 23; h += 1) {
    out.push(`${String(h).padStart(2, '0')}:00`)
    if (h < 23) out.push(`${String(h).padStart(2, '0')}:30`)
  }
  out.push('23:30')
  return out
}
