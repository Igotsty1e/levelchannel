// Wave 39: pure-function validation extracted from slots.ts.
// Imports types and the MAX_*_LEN constants from internal; no DB calls.

import { MAX_NOTES_LEN, UUID_PATTERN } from './internal'
import type {
  BulkPreviewError,
  BulkPreviewInput,
  SlotStartValidationError,
  SlotValidationError,
} from './types'
import {
  MSK_BUSINESS_HOUR_MAX,
  MSK_BUSINESS_HOUR_MIN,
  SLOT_GRID_MINUTES,
} from './types'

// Return null when the new MSK wall-clock instant satisfies both
// the business-band and 30-minute-grid invariants. Otherwise return
// a structured error the route maps to a 400 response.
export function validateSlotStartMsk(
  startMs: number,
): SlotStartValidationError | null {
  const mskWall = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Moscow',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date(startMs))
  const mskParts: Record<string, number> = {}
  for (const p of mskWall) {
    if (p.type === 'literal') continue
    mskParts[p.type] = Number(p.value)
  }
  const hour = mskParts.hour === 24 ? 0 : mskParts.hour
  const minute = mskParts.minute
  const second = mskParts.second
  if (
    hour < MSK_BUSINESS_HOUR_MIN ||
    hour > MSK_BUSINESS_HOUR_MAX ||
    (hour === MSK_BUSINESS_HOUR_MAX && minute > 0)
  ) {
    return {
      code: 'slot/start_out_of_band',
      message: `Slot start must be ${String(MSK_BUSINESS_HOUR_MIN).padStart(2, '0')}:00–${String(MSK_BUSINESS_HOUR_MAX).padStart(2, '0')}:00 MSK.`,
    }
  }
  // minute-start epic (2026-06-11): был 30-min grid check; теперь
  // разрешена любая минута, только seconds=0 (sanity invariant —
  // совпадает с migration 0125).
  void minute
  if (second !== 0) {
    return {
      code: 'slot/start_not_30min_aligned',
      message: 'Slot start must have zero seconds.',
    }
  }
  return null
}

export function validateSlotInput(input: {
  teacherAccountId?: string
  startAt?: string
  durationMinutes?: number
  notes?: string | null
}): SlotValidationError | null {
  if (
    input.teacherAccountId !== undefined &&
    !UUID_PATTERN.test(input.teacherAccountId)
  ) {
    return { field: 'teacherAccountId', reason: 'invalid' }
  }
  if (input.startAt !== undefined) {
    const ts = Date.parse(input.startAt)
    if (Number.isNaN(ts)) {
      return { field: 'startAt', reason: 'invalid' }
    }
    if (ts <= Date.now()) {
      return { field: 'startAt', reason: 'in_past' }
    }
  }
  if (input.durationMinutes !== undefined) {
    if (!Number.isInteger(input.durationMinutes)) {
      return { field: 'durationMinutes', reason: 'not_integer' }
    }
    if (input.durationMinutes < 15 || input.durationMinutes > 180) {
      return { field: 'durationMinutes', reason: 'out_of_band' }
    }
  }
  if (input.notes !== undefined && input.notes !== null) {
    if (input.notes.length > MAX_NOTES_LEN) {
      return { field: 'notes', reason: 'too_long' }
    }
  }
  return null
}

// ---- bulk preview ----

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const MAX_BULK_WEEKS = 26 // half a year

// Map a 'YYYY-MM-DD' date + 'HH:MM' time + IANA tz to a UTC instant.
// Uses Intl.DateTimeFormat to find the offset of that wall-clock time
// in the given tz, then constructs the UTC date.
function wallTimeToUtcIso(
  dateYmd: string,
  timeHhmm: string,
  timezone: string,
): string | null {
  // Parse YMD components.
  const [yearStr, monthStr, dayStr] = dateYmd.split('-')
  const [hourStr, minuteStr] = timeHhmm.split(':')
  const year = Number(yearStr)
  const month = Number(monthStr)
  const day = Number(dayStr)
  const hour = Number(hourStr)
  const minute = Number(minuteStr)
  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day) ||
    !Number.isFinite(hour) ||
    !Number.isFinite(minute)
  ) {
    return null
  }
  // Build a candidate UTC instant assuming the wall time IS UTC, then
  // measure the tz offset the candidate produces, and subtract it.
  // Two iterations converge across DST boundaries.
  let utcMs = Date.UTC(year, month - 1, day, hour, minute, 0)
  for (let i = 0; i < 2; i += 1) {
    const offsetMin = tzOffsetMinutes(utcMs, timezone)
    utcMs = Date.UTC(year, month - 1, day, hour, minute, 0) - offsetMin * 60_000
  }
  return new Date(utcMs).toISOString()
}

// Returns the offset (in minutes east of UTC) that `timezone` is at
// the given UTC instant. E.g. Europe/Moscow → +180 year-round.
function tzOffsetMinutes(utcMs: number, timezone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  const parts = dtf.formatToParts(new Date(utcMs))
  const map: Record<string, number> = {}
  for (const p of parts) {
    if (p.type === 'literal') continue
    map[p.type] = Number(p.value)
  }
  // Some locales return hour as 24 for midnight; clamp.
  const hour = map.hour === 24 ? 0 : map.hour
  const localMs = Date.UTC(
    map.year,
    map.month - 1,
    map.day,
    hour,
    map.minute,
    map.second,
  )
  return Math.round((localMs - utcMs) / 60_000)
}

export function bulkGeneratePreview(
  input: BulkPreviewInput,
): { ok: true; slots: { startAt: string; date: string; time: string }[] } | { ok: false; error: BulkPreviewError } {
  if (!Array.isArray(input.weekdays) || input.weekdays.length === 0) {
    return { ok: false, error: { field: 'weekdays', reason: 'empty' } }
  }
  for (const w of input.weekdays) {
    if (!Number.isInteger(w) || w < 0 || w > 6) {
      return { ok: false, error: { field: 'weekdays', reason: 'invalid' } }
    }
  }
  if (!TIME_PATTERN.test(input.startTime)) {
    return { ok: false, error: { field: 'startTime', reason: 'invalid' } }
  }
  if (!DATE_PATTERN.test(input.startDate)) {
    return { ok: false, error: { field: 'startDate', reason: 'invalid' } }
  }
  if (
    !Number.isInteger(input.weeks) ||
    input.weeks < 1 ||
    input.weeks > MAX_BULK_WEEKS
  ) {
    return { ok: false, error: { field: 'weeks', reason: 'out_of_band' } }
  }
  if (!Number.isInteger(input.durationMinutes)) {
    return {
      ok: false,
      error: { field: 'durationMinutes', reason: 'not_integer' },
    }
  }
  if (input.durationMinutes < 15 || input.durationMinutes > 180) {
    return {
      ok: false,
      error: { field: 'durationMinutes', reason: 'out_of_band' },
    }
  }
  const skip = new Set<string>()
  if (input.skipDates) {
    for (const s of input.skipDates) {
      if (!DATE_PATTERN.test(s)) {
        return { ok: false, error: { field: 'skipDates', reason: 'invalid' } }
      }
      skip.add(s)
    }
  }
  const tz = input.timezone || 'Europe/Moscow'
  const weekdays = new Set<number>(input.weekdays)
  const slots: { startAt: string; date: string; time: string }[] = []

  // Walk day-by-day from startDate for weeks*7 days; for each day
  // whose weekday is in the set and which isn't in skipDates, emit a
  // slot at startTime.
  const startMs = Date.parse(`${input.startDate}T00:00:00Z`)
  if (Number.isNaN(startMs)) {
    return { ok: false, error: { field: 'startDate', reason: 'invalid' } }
  }
  for (let i = 0; i < input.weeks * 7; i += 1) {
    const dayMs = startMs + i * 86_400_000
    const d = new Date(dayMs)
    // We want the weekday IN THE OPERATOR'S TZ. Get the local Y-M-D
    // string for this day in the tz, then derive weekday from there.
    const dateInTz = isoDateInTz(dayMs, tz)
    const weekday = weekdayInTz(dayMs, tz)
    if (!weekdays.has(weekday)) continue
    if (skip.has(dateInTz)) continue
    const utc = wallTimeToUtcIso(dateInTz, input.startTime, tz)
    if (!utc) continue
    // Skip past slots silently — operator setting startDate to today
    // shouldn't fail the whole batch.
    if (Date.parse(utc) <= Date.now()) continue
    slots.push({ startAt: utc, date: dateInTz, time: input.startTime })
    void d // keep var to avoid unused
  }
  return { ok: true, slots }
}

function isoDateInTz(utcMs: number, timezone: string): string {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  return dtf.format(new Date(utcMs))
}

function weekdayInTz(utcMs: number, timezone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
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
  return map[dtf.format(new Date(utcMs))] ?? 0
}

// BCS-DEF-3 (2026-05-18) — validate a zoom URL for slot.zoomUrl.
// Returns null when valid; otherwise structured error. Empty string
// and null both clear the field (the caller passes null to the
// helper). Constraints:
//   - max 512 chars (matches DB CHECK + lesson_slots_zoom_url_shape);
//   - must start with `https://` (no http: or javascript: schemes);
//   - URL constructor must accept it (rules out garbage like `https://`
//     alone).
// The validator is a pure function so the admin + teacher routes
// share one source of truth. DB CHECK is the safety net at the
// schema layer.
export const MAX_ZOOM_URL_LEN = 512

export type ZoomUrlValidationError = { field: 'zoomUrl'; reason: 'too_long' | 'invalid_scheme' | 'invalid_url' }

export function validateZoomUrl(raw: string): ZoomUrlValidationError | null {
  if (raw.length > MAX_ZOOM_URL_LEN) {
    return { field: 'zoomUrl', reason: 'too_long' }
  }
  if (!raw.startsWith('https://')) {
    return { field: 'zoomUrl', reason: 'invalid_scheme' }
  }
  try {
    const u = new URL(raw)
    if (u.protocol !== 'https:') {
      return { field: 'zoomUrl', reason: 'invalid_scheme' }
    }
    if (!u.hostname) {
      return { field: 'zoomUrl', reason: 'invalid_url' }
    }
  } catch {
    return { field: 'zoomUrl', reason: 'invalid_url' }
  }
  return null
}
