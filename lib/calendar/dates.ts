// MSK timezone helpers + strict YYYY-MM-DD parsing for the calendar
// surface. Wave A — single home for time math so the calendar
// component, the calendar endpoint, and the existing admin
// single-create / bulk-create paths all agree on what a given MSK
// wall time means.
//
// Why one home: existing single-create UI serialized browser-local
// time, bulk-create used MSK, the calendar would have been a third
// writer. After PR1, all three route through the same primitives
// here. See `docs/plans/calendar-ui.md` Wave A PR1.
//
// MSK = Europe/Moscow = UTC+3 year-round (no DST since 2014).
// We rely on `Intl.DateTimeFormat` with `timeZone: 'Europe/Moscow'`
// for the offset — Postgres `at time zone 'Europe/Moscow'` mirrors
// it server-side. Both tracks use system tzdata, which makes them
// consistent across a future legal-regime change.

const MSK_TIMEZONE = 'Europe/Moscow'
const YMD_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
const HHMM_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/

// Returns the offset (minutes east of UTC) that `Europe/Moscow` is at
// the given UTC instant. Always +180 today; helper exists so a future
// DST reactivation is one-liner away.
export function mskOffsetMinutes(utcMs: number): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: MSK_TIMEZONE,
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

// 'YYYY-MM-DD' + 'HH:MM' (MSK wall) → ISO UTC instant.
// Returns null on malformed input. Convergence loop handles the
// hypothetical DST boundary where naive UTC.UTC misses by an hour.
export function mskWallToUtcIso(
  dateYmd: string,
  timeHhmm: string,
): string | null {
  if (!isValidYmd(dateYmd)) return null
  if (!HHMM_PATTERN.test(timeHhmm)) return null
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
  let utcMs = Date.UTC(year, month - 1, day, hour, minute, 0)
  for (let i = 0; i < 2; i += 1) {
    const offsetMin = mskOffsetMinutes(utcMs)
    utcMs = Date.UTC(year, month - 1, day, hour, minute, 0) - offsetMin * 60_000
  }
  return new Date(utcMs).toISOString()
}

// 'YYYY-MM-DD' → ISO UTC of MSK midnight that day.
// E.g. '2026-05-10' → '2026-05-09T21:00:00.000Z' (MSK = UTC+3).
export function mskMidnightUtc(dateYmd: string): string | null {
  return mskWallToUtcIso(dateYmd, '00:00')
}

// Strict YYYY-MM-DD validator. Returns true only for canonical form;
// rejects ISO timestamps, slashed dates, words, anything else.
export function isValidYmd(s: string): boolean {
  if (!YMD_PATTERN.test(s)) return false
  const [yearStr, monthStr, dayStr] = s.split('-')
  const year = Number(yearStr)
  const month = Number(monthStr)
  const day = Number(dayStr)
  if (year < 1900 || year > 2100) return false
  if (month < 1 || month > 12) return false
  if (day < 1 || day > 31) return false
  // Round-trip via UTC Date to reject 2026-13-01 / 2026-02-30.
  const candidate = new Date(Date.UTC(year, month - 1, day))
  return (
    candidate.getUTCFullYear() === year &&
    candidate.getUTCMonth() === month - 1 &&
    candidate.getUTCDate() === day
  )
}

// Days difference (UTC midnight to UTC midnight). 'YYYY-MM-DD' inputs.
// Returns null if either input is invalid.
export function ymdDaysDiff(fromYmd: string, toYmd: string): number | null {
  if (!isValidYmd(fromYmd) || !isValidYmd(toYmd)) return null
  const [fy, fm, fd] = fromYmd.split('-').map(Number)
  const [ty, tm, td] = toYmd.split('-').map(Number)
  const fromMs = Date.UTC(fy, fm - 1, fd)
  const toMs = Date.UTC(ty, tm - 1, td)
  return Math.round((toMs - fromMs) / 86_400_000)
}

// Format a UTC instant as 'HH:MM' in MSK. Used by the calendar to
// label slot blocks ("18:00 – 18:50").
export function formatMskHhmm(utcMs: number): string {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: MSK_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  // formatToParts to handle locale's "24" hour edge case consistently
  const parts = dtf.formatToParts(new Date(utcMs))
  const map: Record<string, number> = {}
  for (const p of parts) {
    if (p.type === 'literal') continue
    map[p.type] = Number(p.value)
  }
  const hour = map.hour === 24 ? 0 : map.hour
  return `${String(hour).padStart(2, '0')}:${String(map.minute).padStart(2, '0')}`
}

// Format a UTC instant as 'YYYY-MM-DD' in MSK. Used by view-model
// to bucket slots into day columns.
export function formatMskYmd(utcMs: number): string {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone: MSK_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  // en-CA formats as YYYY-MM-DD natively, perfect for our use.
  return dtf.format(new Date(utcMs))
}

// Constants for the calendar grid.
export const CALENDAR_GRID_START_HOUR = 6
export const CALENDAR_GRID_END_HOUR = 23 // last row label (renders 06:00 → 23:30)
export const CALENDAR_GRID_PX_PER_MIN = 1.5
export const CALENDAR_GRID_DAY_HEIGHT_PX =
  ((CALENDAR_GRID_END_HOUR + 0.5 - CALENDAR_GRID_START_HOUR) * 60) *
  CALENDAR_GRID_PX_PER_MIN
