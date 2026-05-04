import { getDbPool } from '@/lib/db/pool'

export type SlotStatus =
  | 'open'
  | 'booked'
  | 'cancelled'
  | 'completed'
  | 'no_show_learner'
  | 'no_show_teacher'

// Statuses that the operator can stamp on a booked slot whose start
// has already passed. Phase 5 lifecycle.
export type SlotLifecycleStatus =
  | 'completed'
  | 'no_show_learner'
  | 'no_show_teacher'

export const LIFECYCLE_STATUSES: SlotLifecycleStatus[] = [
  'completed',
  'no_show_learner',
  'no_show_teacher',
]

export const TERMINAL_STATUSES: SlotStatus[] = [
  'cancelled',
  'completed',
  'no_show_learner',
  'no_show_teacher',
]

// Phase 5 — 24-hour rule: a learner can cancel only if start_at is
// at least 24 hours away. Operator/admin paths bypass this — they
// have the override.
//
// Pure function so the cabinet UI can check it client-side too without
// re-implementing the threshold.
export const LEARNER_CANCEL_THRESHOLD_MS = 24 * 60 * 60 * 1000

export type LearnerCancelDecision =
  | { ok: true }
  | { ok: false; reason: 'already_terminal' | 'too_late_to_cancel'; minutesUntilStart?: number }

export function canLearnerCancel(
  slot: { status: SlotStatus; startAt: string },
  nowMs = Date.now(),
): LearnerCancelDecision {
  if (slot.status !== 'booked') {
    return { ok: false, reason: 'already_terminal' }
  }
  const startMs = new Date(slot.startAt).getTime()
  if (Number.isNaN(startMs)) {
    return { ok: false, reason: 'already_terminal' }
  }
  const diffMs = startMs - nowMs
  if (diffMs < LEARNER_CANCEL_THRESHOLD_MS) {
    return {
      ok: false,
      reason: 'too_late_to_cancel',
      minutesUntilStart: Math.max(0, Math.floor(diffMs / 60_000)),
    }
  }
  return { ok: true }
}

export type LessonSlot = {
  id: string
  teacherAccountId: string
  teacherEmail?: string | null
  startAt: string
  durationMinutes: number
  status: SlotStatus
  learnerAccountId: string | null
  learnerEmail?: string | null
  bookedAt: string | null
  cancelledAt: string | null
  cancelledByAccountId: string | null
  cancellationReason: string | null
  // Phase 5: when the lifecycle status was set (auto-complete cron
  // stamps it, operator "mark" endpoint stamps it). Null on rows
  // that never reached completed / no_show_*.
  markedAt: string | null
  // Phase 6: optional binding to a pricing tariff. Operator picks at
  // create time. Null = no auto-bound price (cabinet shows no
  // «оплатить» action for that slot).
  tariffId: string | null
  tariffSlug?: string | null
  tariffTitleRu?: string | null
  tariffAmountKopecks?: number | null
  notes: string | null
  events: SlotEvent[]
  createdAt: string
  updatedAt: string
}

export type SlotEvent = {
  type: string
  at: string
  actor?: string | null
  payload?: Record<string, unknown>
}

const SLOT_COLUMNS = `
  id,
  teacher_account_id,
  start_at,
  duration_minutes,
  status,
  learner_account_id,
  booked_at,
  cancelled_at,
  cancelled_by_account_id,
  cancellation_reason,
  marked_at,
  tariff_id,
  notes,
  events,
  created_at,
  updated_at
`

function rowToSlot(
  row: Record<string, unknown>,
  extra: {
    teacherEmail?: string | null
    learnerEmail?: string | null
    tariffSlug?: string | null
    tariffTitleRu?: string | null
    tariffAmountKopecks?: number | null
  } = {},
): LessonSlot {
  return {
    id: String(row.id),
    teacherAccountId: String(row.teacher_account_id),
    teacherEmail: extra.teacherEmail ?? null,
    startAt: new Date(String(row.start_at)).toISOString(),
    durationMinutes: Number(row.duration_minutes),
    status: String(row.status) as SlotStatus,
    learnerAccountId: row.learner_account_id
      ? String(row.learner_account_id)
      : null,
    learnerEmail: extra.learnerEmail ?? null,
    bookedAt: row.booked_at
      ? new Date(String(row.booked_at)).toISOString()
      : null,
    cancelledAt: row.cancelled_at
      ? new Date(String(row.cancelled_at)).toISOString()
      : null,
    cancelledByAccountId: row.cancelled_by_account_id
      ? String(row.cancelled_by_account_id)
      : null,
    cancellationReason: row.cancellation_reason
      ? String(row.cancellation_reason)
      : null,
    markedAt: row.marked_at
      ? new Date(String(row.marked_at)).toISOString()
      : null,
    tariffId: row.tariff_id ? String(row.tariff_id) : null,
    tariffSlug: extra.tariffSlug ?? null,
    tariffTitleRu: extra.tariffTitleRu ?? null,
    tariffAmountKopecks: extra.tariffAmountKopecks ?? null,
    notes: row.notes ? String(row.notes) : null,
    events: Array.isArray(row.events)
      ? (row.events as SlotEvent[])
      : [],
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  }
}

// ---- validation ----

export type SlotValidationError =
  | { field: 'startAt'; reason: 'invalid' | 'in_past' }
  | { field: 'durationMinutes'; reason: 'out_of_band' | 'not_integer' }
  | { field: 'teacherAccountId'; reason: 'invalid' }
  | { field: 'notes'; reason: 'too_long' }
  | { field: 'cancellationReason'; reason: 'too_long' }

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_NOTES_LEN = 500
const MAX_REASON_LEN = 500

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

// ---- bulk preview / create ----

export type BulkPreviewInput = {
  weekdays: number[] // 0=Sunday..6=Saturday
  startTime: string // 'HH:MM'
  startDate: string // 'YYYY-MM-DD'
  weeks: number
  durationMinutes: number
  skipDates?: string[] // 'YYYY-MM-DD'
  // Display tz for parsing startTime + startDate. Default Europe/Moscow
  // per D5. The generated `startAt` values are absolute ISO timestamps;
  // the operator's tz only affects how 'HH:MM on YYYY-MM-DD' is mapped
  // to UTC.
  timezone?: string
}

export type BulkPreviewError =
  | { field: 'weekdays'; reason: 'empty' | 'invalid' }
  | { field: 'startTime'; reason: 'invalid' }
  | { field: 'startDate'; reason: 'invalid' }
  | { field: 'weeks'; reason: 'out_of_band' }
  | { field: 'durationMinutes'; reason: 'out_of_band' | 'not_integer' }
  | { field: 'skipDates'; reason: 'invalid' }

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

// ---- store ops ----

export async function listOpenFutureSlots(params: {
  teacherAccountId?: string | null
  fromIso?: string
  toIso?: string
  limit?: number
}): Promise<LessonSlot[]> {
  const pool = getDbPool()
  const limit = Math.min(Math.max(params.limit ?? 200, 1), 500)
  const args: unknown[] = [params.fromIso ?? new Date().toISOString()]
  let where = `status = 'open' and start_at >= $1`
  if (params.toIso) {
    args.push(params.toIso)
    where += ` and start_at <= $${args.length}`
  }
  if (params.teacherAccountId) {
    args.push(params.teacherAccountId)
    where += ` and teacher_account_id = $${args.length}`
  }
  args.push(limit)
  const result = await pool.query(
    `select s.id, s.teacher_account_id, s.start_at, s.duration_minutes,
            s.status, s.learner_account_id, s.booked_at, s.cancelled_at,
            s.cancelled_by_account_id, s.cancellation_reason, s.marked_at,
            s.tariff_id, s.notes,
            s.events, s.created_at, s.updated_at,
            ta.email as teacher_email,
            t.slug as tariff_slug,
            t.title_ru as tariff_title_ru,
            t.amount_kopecks as tariff_amount_kopecks
       from lesson_slots s
       join accounts ta on ta.id = s.teacher_account_id
       left join pricing_tariffs t on t.id = s.tariff_id
      where ${where}
      order by s.start_at asc
      limit $${args.length}`,
    args,
  )
  return result.rows.map((r) =>
    rowToSlot(r, {
      teacherEmail: r.teacher_email ? String(r.teacher_email) : null,
      tariffSlug: r.tariff_slug ? String(r.tariff_slug) : null,
      tariffTitleRu: r.tariff_title_ru ? String(r.tariff_title_ru) : null,
      tariffAmountKopecks:
        r.tariff_amount_kopecks !== null && r.tariff_amount_kopecks !== undefined
          ? Number(r.tariff_amount_kopecks)
          : null,
    }),
  )
}

// Phase 7+: cabinet view for users holding the `teacher` role.
// Returns slots they're teaching ordered by start_at desc so upcoming
// + recent past are visible. Read-only — teachers don't yet self-
// manage their schedule (operator manages /admin/slots).
export async function listSlotsAsTeacher(
  teacherAccountId: string,
  limit = 50,
): Promise<LessonSlot[]> {
  const pool = getDbPool()
  const result = await pool.query(
    `select s.id, s.teacher_account_id, s.start_at, s.duration_minutes,
            s.status, s.learner_account_id, s.booked_at, s.cancelled_at,
            s.cancelled_by_account_id, s.cancellation_reason, s.marked_at,
            s.tariff_id, s.notes,
            s.events, s.created_at, s.updated_at,
            ta.email as teacher_email,
            la.email as learner_email,
            t.slug as tariff_slug,
            t.title_ru as tariff_title_ru,
            t.amount_kopecks as tariff_amount_kopecks
       from lesson_slots s
       join accounts ta on ta.id = s.teacher_account_id
       left join accounts la on la.id = s.learner_account_id
       left join pricing_tariffs t on t.id = s.tariff_id
      where s.teacher_account_id = $1
      order by s.start_at desc
      limit $2`,
    [teacherAccountId, Math.min(Math.max(limit, 1), 200)],
  )
  return result.rows.map((r) =>
    rowToSlot(r, {
      teacherEmail: r.teacher_email ? String(r.teacher_email) : null,
      learnerEmail: r.learner_email ? String(r.learner_email) : null,
      tariffSlug: r.tariff_slug ? String(r.tariff_slug) : null,
      tariffTitleRu: r.tariff_title_ru ? String(r.tariff_title_ru) : null,
      tariffAmountKopecks:
        r.tariff_amount_kopecks !== null && r.tariff_amount_kopecks !== undefined
          ? Number(r.tariff_amount_kopecks)
          : null,
    }),
  )
}

export async function listSlotsForLearner(
  learnerAccountId: string,
  limit = 50,
): Promise<LessonSlot[]> {
  const pool = getDbPool()
  const result = await pool.query(
    `select s.id, s.teacher_account_id, s.start_at, s.duration_minutes,
            s.status, s.learner_account_id, s.booked_at, s.cancelled_at,
            s.cancelled_by_account_id, s.cancellation_reason, s.marked_at,
            s.tariff_id, s.notes,
            s.events, s.created_at, s.updated_at,
            ta.email as teacher_email,
            t.slug as tariff_slug,
            t.title_ru as tariff_title_ru,
            t.amount_kopecks as tariff_amount_kopecks
       from lesson_slots s
       join accounts ta on ta.id = s.teacher_account_id
       left join pricing_tariffs t on t.id = s.tariff_id
      where s.learner_account_id = $1
      order by s.start_at desc
      limit $2`,
    [learnerAccountId, Math.min(Math.max(limit, 1), 200)],
  )
  return result.rows.map((r) =>
    rowToSlot(r, {
      teacherEmail: r.teacher_email ? String(r.teacher_email) : null,
      tariffSlug: r.tariff_slug ? String(r.tariff_slug) : null,
      tariffTitleRu: r.tariff_title_ru ? String(r.tariff_title_ru) : null,
      tariffAmountKopecks:
        r.tariff_amount_kopecks !== null && r.tariff_amount_kopecks !== undefined
          ? Number(r.tariff_amount_kopecks)
          : null,
    }),
  )
}

export async function listAllSlotsForAdmin(params: {
  status?: SlotStatus | 'all'
  fromIso?: string
  toIso?: string
  limit?: number
}): Promise<LessonSlot[]> {
  const pool = getDbPool()
  const limit = Math.min(Math.max(params.limit ?? 200, 1), 500)
  const args: unknown[] = []
  const clauses: string[] = []
  if (params.status && params.status !== 'all') {
    args.push(params.status)
    clauses.push(`s.status = $${args.length}`)
  }
  if (params.fromIso) {
    args.push(params.fromIso)
    clauses.push(`s.start_at >= $${args.length}`)
  }
  if (params.toIso) {
    args.push(params.toIso)
    clauses.push(`s.start_at <= $${args.length}`)
  }
  const where = clauses.length ? `where ${clauses.join(' and ')}` : ''
  args.push(limit)
  const result = await pool.query(
    `select s.id, s.teacher_account_id, s.start_at, s.duration_minutes,
            s.status, s.learner_account_id, s.booked_at, s.cancelled_at,
            s.cancelled_by_account_id, s.cancellation_reason, s.marked_at,
            s.tariff_id, s.notes,
            s.events, s.created_at, s.updated_at,
            ta.email as teacher_email,
            la.email as learner_email,
            t.slug as tariff_slug,
            t.title_ru as tariff_title_ru,
            t.amount_kopecks as tariff_amount_kopecks
       from lesson_slots s
       join accounts ta on ta.id = s.teacher_account_id
       left join accounts la on la.id = s.learner_account_id
       left join pricing_tariffs t on t.id = s.tariff_id
       ${where}
       order by s.start_at asc
       limit $${args.length}`,
    args,
  )
  return result.rows.map((r) =>
    rowToSlot(r, {
      teacherEmail: r.teacher_email ? String(r.teacher_email) : null,
      learnerEmail: r.learner_email ? String(r.learner_email) : null,
      tariffSlug: r.tariff_slug ? String(r.tariff_slug) : null,
      tariffTitleRu: r.tariff_title_ru ? String(r.tariff_title_ru) : null,
      tariffAmountKopecks:
        r.tariff_amount_kopecks !== null && r.tariff_amount_kopecks !== undefined
          ? Number(r.tariff_amount_kopecks)
          : null,
    }),
  )
}

export async function getSlotById(id: string): Promise<LessonSlot | null> {
  if (!UUID_PATTERN.test(id)) return null
  const pool = getDbPool()
  const result = await pool.query(
    `select ${SLOT_COLUMNS} from lesson_slots where id = $1`,
    [id],
  )
  return result.rows[0] ? rowToSlot(result.rows[0]) : null
}

export type CreateSlotInput = {
  teacherAccountId: string
  startAt: string
  durationMinutes: number
  notes?: string | null
  tariffId?: string | null
}

export async function createSlot(
  input: CreateSlotInput,
): Promise<LessonSlot> {
  const validation = validateSlotInput(input)
  if (validation) {
    throw new Error(`slot/${validation.field}/${validation.reason}`)
  }
  if (input.tariffId !== undefined && input.tariffId !== null) {
    if (!UUID_PATTERN.test(input.tariffId)) {
      throw new Error('slot/tariffId/invalid')
    }
  }
  const pool = getDbPool()
  const result = await pool.query(
    `insert into lesson_slots (
       teacher_account_id, start_at, duration_minutes, notes, tariff_id, events
     ) values ($1, $2, $3, $4, $5, $6::jsonb)
     returning ${SLOT_COLUMNS}`,
    [
      input.teacherAccountId,
      input.startAt,
      input.durationMinutes,
      input.notes ?? null,
      input.tariffId ?? null,
      JSON.stringify([
        {
          type: 'slot.created',
          at: new Date().toISOString(),
          actor: 'admin',
        },
      ]),
    ],
  )
  return rowToSlot(result.rows[0])
}

export type BulkCreateInput = {
  teacherAccountId: string
  durationMinutes: number
  notes?: string | null
  tariffId?: string | null
  slots: { startAt: string }[]
}

export type BulkCreateResult = {
  created: LessonSlot[]
  skippedConflicts: string[] // startAt values that hit the unique constraint
}

export async function bulkCreateSlots(
  input: BulkCreateInput,
): Promise<BulkCreateResult> {
  const validation = validateSlotInput({
    teacherAccountId: input.teacherAccountId,
    durationMinutes: input.durationMinutes,
    notes: input.notes ?? null,
  })
  if (validation) {
    throw new Error(`slot/${validation.field}/${validation.reason}`)
  }
  if (!Array.isArray(input.slots) || input.slots.length === 0) {
    throw new Error('slot/slots/empty')
  }
  if (input.slots.length > 200) {
    throw new Error('slot/slots/too_many')
  }
  for (const s of input.slots) {
    const v = validateSlotInput({ startAt: s.startAt })
    if (v) throw new Error(`slot/${v.field}/${v.reason}`)
  }
  if (input.tariffId !== undefined && input.tariffId !== null) {
    if (!UUID_PATTERN.test(input.tariffId)) {
      throw new Error('slot/tariffId/invalid')
    }
  }

  const pool = getDbPool()
  const created: LessonSlot[] = []
  const skipped: string[] = []
  const eventBlob = JSON.stringify([
    {
      type: 'slot.created',
      at: new Date().toISOString(),
      actor: 'admin',
      payload: { source: 'bulk' },
    },
  ])

  const client = await pool.connect()
  try {
    await client.query('begin')
    for (const s of input.slots) {
      try {
        const result = await client.query(
          `insert into lesson_slots (
             teacher_account_id, start_at, duration_minutes, notes, tariff_id, events
           ) values ($1, $2, $3, $4, $5, $6::jsonb)
           on conflict (teacher_account_id, start_at) do nothing
           returning ${SLOT_COLUMNS}`,
          [
            input.teacherAccountId,
            s.startAt,
            input.durationMinutes,
            input.notes ?? null,
            input.tariffId ?? null,
            eventBlob,
          ],
        )
        if (result.rows[0]) {
          created.push(rowToSlot(result.rows[0]))
        } else {
          skipped.push(s.startAt)
        }
      } catch (err) {
        // Single-row failure aborts the whole batch — operator picked
        // these slots manually, partial commit would be confusing.
        await client.query('rollback')
        throw err
      }
    }
    await client.query('commit')
  } finally {
    client.release()
  }

  return { created, skippedConflicts: skipped }
}

// ---- mutations ----

function appendEventSql(eventType: string, actor: string | null, payload?: Record<string, unknown>) {
  const event = {
    type: eventType,
    at: new Date().toISOString(),
    actor,
    ...(payload ? { payload } : {}),
  }
  return JSON.stringify([event])
}

// Atomic book-the-slot. Re-asserts status='open' in the WHERE so two
// concurrent POSTs don't both win.
export async function bookSlot(
  slotId: string,
  learnerAccountId: string,
  actor: 'learner' | 'admin' = 'learner',
): Promise<{ ok: true; slot: LessonSlot } | { ok: false; reason: 'not_found' | 'not_open' | 'in_past' }> {
  if (!UUID_PATTERN.test(slotId)) return { ok: false, reason: 'not_found' }
  const pool = getDbPool()
  const result = await pool.query(
    `update lesson_slots
        set status = 'booked',
            learner_account_id = $2,
            booked_at = now(),
            updated_at = now(),
            events = $3::jsonb || events
      where id = $1
        and status = 'open'
        and start_at > now()
      returning ${SLOT_COLUMNS}`,
    [
      slotId,
      learnerAccountId,
      appendEventSql('slot.booked', actor, { learnerAccountId }),
    ],
  )
  if (result.rows[0]) {
    return { ok: true, slot: rowToSlot(result.rows[0]) }
  }
  // Distinguish not-found vs not-open vs in-past for nicer errors.
  const sniff = await pool.query(
    `select status, start_at from lesson_slots where id = $1`,
    [slotId],
  )
  if (sniff.rows.length === 0) return { ok: false, reason: 'not_found' }
  const startAt = new Date(String(sniff.rows[0].start_at)).getTime()
  if (startAt <= Date.now()) return { ok: false, reason: 'in_past' }
  return { ok: false, reason: 'not_open' }
}

export async function cancelSlot(
  slotId: string,
  cancelledByAccountId: string,
  reason: string | null,
  actor: 'learner' | 'admin',
): Promise<LessonSlot | null> {
  if (!UUID_PATTERN.test(slotId)) return null
  if (reason && reason.length > MAX_REASON_LEN) {
    throw new Error('slot/cancellationReason/too_long')
  }
  const pool = getDbPool()
  const result = await pool.query(
    `update lesson_slots
        set status = 'cancelled',
            cancelled_at = coalesce(cancelled_at, now()),
            cancelled_by_account_id = $2,
            cancellation_reason = $3,
            updated_at = now(),
            events = $4::jsonb || events
      where id = $1
        and status <> 'cancelled'
      returning ${SLOT_COLUMNS}`,
    [
      slotId,
      cancelledByAccountId,
      reason,
      appendEventSql('slot.cancelled', actor, { cancelledByAccountId, reason }),
    ],
  )
  return result.rows[0] ? rowToSlot(result.rows[0]) : null
}

export async function editOpenSlot(
  slotId: string,
  patch: { startAt?: string; durationMinutes?: number; notes?: string | null },
): Promise<LessonSlot | null> {
  if (!UUID_PATTERN.test(slotId)) return null
  const validation = validateSlotInput(patch)
  if (validation) {
    throw new Error(`slot/${validation.field}/${validation.reason}`)
  }
  const pool = getDbPool()
  const result = await pool.query(
    `update lesson_slots
        set start_at = case when $2 then $3::timestamptz else start_at end,
            duration_minutes = case when $4 then $5::int else duration_minutes end,
            notes = case when $6 then $7 else notes end,
            updated_at = now(),
            events = $8::jsonb || events
      where id = $1
        and status = 'open'
      returning ${SLOT_COLUMNS}`,
    [
      slotId,
      'startAt' in patch,
      patch.startAt ?? null,
      'durationMinutes' in patch,
      patch.durationMinutes ?? null,
      'notes' in patch,
      patch.notes ?? null,
      appendEventSql('slot.edited', 'admin', patch as Record<string, unknown>),
    ],
  )
  return result.rows[0] ? rowToSlot(result.rows[0]) : null
}

// Phase 5: operator stamps a lifecycle status on a booked slot whose
// start has already passed. Refuses if the row is not booked or if
// start_at is still in the future.
export async function markSlotLifecycle(
  slotId: string,
  status: SlotLifecycleStatus,
  actorAccountId: string,
): Promise<{ ok: true; slot: LessonSlot } | { ok: false; reason: 'not_found' | 'not_booked' | 'not_yet_started' }> {
  if (!UUID_PATTERN.test(slotId)) return { ok: false, reason: 'not_found' }
  const pool = getDbPool()
  const result = await pool.query(
    `update lesson_slots
        set status = $2,
            marked_at = coalesce(marked_at, now()),
            updated_at = now(),
            events = $3::jsonb || events
      where id = $1
        and status = 'booked'
        and start_at <= now()
      returning ${SLOT_COLUMNS}`,
    [
      slotId,
      status,
      appendEventSql('slot.lifecycle', 'admin', {
        toStatus: status,
        actorAccountId,
      }),
    ],
  )
  if (result.rows[0]) {
    return { ok: true, slot: rowToSlot(result.rows[0]) }
  }
  // Distinguish reasons for friendly errors.
  const sniff = await pool.query(
    `select status, start_at from lesson_slots where id = $1`,
    [slotId],
  )
  if (sniff.rows.length === 0) return { ok: false, reason: 'not_found' }
  if (sniff.rows[0].status !== 'booked') {
    return { ok: false, reason: 'not_booked' }
  }
  return { ok: false, reason: 'not_yet_started' }
}

// Phase 5: auto-complete cron — flip every still-`booked` row whose
// `start_at + duration_minutes` has elapsed to `completed`. Operator
// overrides set status away from `booked` first, so they're naturally
// skipped by the WHERE clause.
export async function autoCompletePastBookedSlots(): Promise<{
  completed: number
}> {
  const pool = getDbPool()
  const event = JSON.stringify([
    {
      type: 'slot.completed',
      at: new Date().toISOString(),
      actor: 'system',
      payload: { source: 'auto-complete' },
    },
  ])
  const result = await pool.query(
    `update lesson_slots
        set status = 'completed',
            marked_at = now(),
            updated_at = now(),
            events = $1::jsonb || events
      where status = 'booked'
        and start_at + (duration_minutes || ' minutes')::interval <= now()`,
    [event],
  )
  return { completed: result.rowCount ?? 0 }
}

export async function deleteOpenSlot(slotId: string): Promise<boolean> {
  if (!UUID_PATTERN.test(slotId)) return false
  const pool = getDbPool()
  const result = await pool.query(
    `delete from lesson_slots where id = $1 and status = 'open'`,
    [slotId],
  )
  return (result.rowCount ?? 0) > 0
}
