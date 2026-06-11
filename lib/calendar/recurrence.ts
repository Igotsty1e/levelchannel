/**
 * SLOT-BULK Sub-PR A — recurrence expansion helper.
 *
 * Plan: docs/plans/slot-bulk-add-form-mobile-2026-06-09.md §4.
 *
 * Pure function: takes form input (date range + days-of-week + times +
 * duration) and produces explicit UTC slot timestamps that the bulk-
 * create endpoint can validate + insert.
 *
 * Invariants (mig 0031):
 *   - start_at must be on 30-min boundary in MSK
 *   - start_at hour-of-MSK must be ∈ [6, 22) OR (== 22 AND minute == 0)
 *
 * The expand function PRE-FILTERS candidates that violate the business-
 * hour window so the preview endpoint never returns server-side
 * surprises to the UI. Slots out of the band land in `skipped` with
 * reason 'outside_business_hours'.
 *
 * MSK is UTC+3 with no DST — simpler arithmetic. We never call into
 * date-fns/Luxon; raw Date math is sufficient and avoids dep churn.
 */

const MSK_OFFSET_MIN = 3 * 60

export type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6

export type RecurrenceInput = {
  startDate: string
  endDate: string
  daysOfWeek: ReadonlyArray<DayOfWeek>
  times: ReadonlyArray<string>
  durationMinutes: number
}

export type ExpandedSlot = {
  startUtcIso: string
  durationMinutes: number
}

export type ExpandedSkip = {
  startUtcIso: string
  reason: 'outside_business_hours' | 'not_30min_aligned' | 'past_start'
}

export type ExpandResult = {
  slots: ExpandedSlot[]
  skipped: ExpandedSkip[]
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/

export class RecurrenceInputError extends Error {
  readonly field: string
  constructor(field: string, message: string) {
    super(`recurrence/${field}/${message}`)
    this.field = field
  }
}

function parseUtcMidnightMs(ymd: string): number {
  if (!DATE_RE.test(ymd)) {
    throw new RecurrenceInputError(`date`, `invalid_format`)
  }
  const [y, m, d] = ymd.split('-').map(Number)
  const ms = Date.UTC(y, m - 1, d, 0, 0, 0, 0)
  if (Number.isNaN(ms)) {
    throw new RecurrenceInputError(`date`, `invalid_date`)
  }
  return ms
}

function parseMskTimeToMinutes(time: string): number {
  const m = TIME_RE.exec(time)
  if (!m) throw new RecurrenceInputError('time', 'invalid_format')
  const hh = Number(m[1])
  const mm = Number(m[2])
  return hh * 60 + mm
}

function withinBusinessHours(mskMinutes: number): boolean {
  // 06:00..21:59 inclusive, plus exactly 22:00.
  if (mskMinutes >= 6 * 60 && mskMinutes < 22 * 60) return true
  if (mskMinutes === 22 * 60) return true
  return false
}

function isAligned30(mskMinutes: number): boolean {
  return mskMinutes % 30 === 0
}

function mskWallToUtcIso(dateMs: number, mskMinutes: number): string {
  // dateMs is UTC-midnight of the calendar day. The teacher inputs the
  // MSK wall-clock time; convert to UTC by subtracting the offset.
  const utcMs = dateMs + mskMinutes * 60 * 1000 - MSK_OFFSET_MIN * 60 * 1000
  return new Date(utcMs).toISOString()
}

function mskDayOfWeek(dateMs: number): DayOfWeek {
  // dateMs is UTC-midnight; in MSK this is 03:00 of the same calendar
  // day, so the day-of-week is preserved.
  return new Date(dateMs).getUTCDay() as DayOfWeek
}

export const MAX_RECURRENCE_SPAN_DAYS = 90
export const MAX_EXPANDED_SLOTS = 200
// 2026-06-11 (minute-duration epic): был whitelist [30, 45, 50, 60, 75,
// 90, 120]. Owner ask — минутная точность. Range matches backend
// `validateSlotInput` (slot duration [15..180]).
export const RECURRENCE_DURATION_MIN = 15
export const RECURRENCE_DURATION_MAX = 180

export function expandRecurrence(input: RecurrenceInput): ExpandResult {
  const startMs = parseUtcMidnightMs(input.startDate)
  const endMs = parseUtcMidnightMs(input.endDate)
  if (endMs < startMs) {
    throw new RecurrenceInputError('endDate', 'before_start')
  }
  const spanDays = Math.round((endMs - startMs) / (24 * 60 * 60 * 1000))
  if (spanDays > MAX_RECURRENCE_SPAN_DAYS) {
    throw new RecurrenceInputError('endDate', 'span_too_long')
  }
  if (input.times.length === 0) {
    throw new RecurrenceInputError('times', 'empty')
  }
  if (
    !Number.isInteger(input.durationMinutes)
    || input.durationMinutes < RECURRENCE_DURATION_MIN
    || input.durationMinutes > RECURRENCE_DURATION_MAX
  ) {
    throw new RecurrenceInputError('durationMinutes', 'not_allowed')
  }
  const days = new Set(input.daysOfWeek)
  if (days.size === 0 && spanDays > 0) {
    throw new RecurrenceInputError('daysOfWeek', 'empty_for_range')
  }

  const minutesList = input.times.map((t) => parseMskTimeToMinutes(t))

  const slots: ExpandedSlot[] = []
  const skipped: ExpandedSkip[] = []
  const nowMs = Date.now()

  for (let dMs = startMs; dMs <= endMs; dMs += 24 * 60 * 60 * 1000) {
    if (spanDays > 0 && !days.has(mskDayOfWeek(dMs))) continue
    for (const mskMinutes of minutesList) {
      const utcIso = mskWallToUtcIso(dMs, mskMinutes)
      if (!isAligned30(mskMinutes)) {
        skipped.push({ startUtcIso: utcIso, reason: 'not_30min_aligned' })
        continue
      }
      if (!withinBusinessHours(mskMinutes)) {
        skipped.push({ startUtcIso: utcIso, reason: 'outside_business_hours' })
        continue
      }
      if (new Date(utcIso).getTime() < nowMs - 60 * 1000) {
        skipped.push({ startUtcIso: utcIso, reason: 'past_start' })
        continue
      }
      slots.push({ startUtcIso: utcIso, durationMinutes: input.durationMinutes })
      if (slots.length > MAX_EXPANDED_SLOTS) {
        return { slots, skipped }
      }
    }
  }

  return { slots, skipped }
}
