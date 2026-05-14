// BCS-G.2 — Hidden-slots surface (plan §4.10).
//
// Returns the teacher's OPEN, future slots whose [start_at, end_at]
// slot_overlaps at least one cached `teacher_external_busy_intervals` row
// where `is_own_event = false`. These are the slots the learner-side
// pre-book filter (BCS-D.5) silently hides from the booking calendar
// because the teacher's external calendar is busy at that time.
//
// Why a separate UI surface: without this, teachers see "my LC
// calendar has open slots in those windows" but learners see "no
// availability there" — confusing if they don't know about the
// Google sync. Surfacing the count + drilldown gives the teacher
// agency: cancel the personal event, or cancel/move the LC slot,
// or accept the gap.
//
// Bounded window (plan §4.10 implicit): we only look [now, now + 30
// days]. Past slots aren't hidable; >30d is out of the pull window.
//
// Pre-conditions handled by the SQL:
//   - status = 'open' AND start_at > now() (no point listing past)
//   - busy_intervals.teacher_account_id = slot.teacher_account_id
//     (defense vs the SELECT joining across teachers — pull worker
//     also constrains this, but the JOIN keeps it true).
//   - busy_intervals.is_own_event = false (don't surface the slot's
//     own pushed event as a "conflict" against itself).
//   - half-open overlap: slot.start_at < busy.end_at AND
//     slot.end_at > busy.start_at (canonical interval overlap).
//
// What's NOT in scope here:
//   - cross-teacher visibility (the pull-side already constrains
//     scope to the teacher's own integration);
//   - encrypted `summary` decryption (the drilldown route reads it
//     itself; this helper returns only counts + minimal slot fields,
//     so the cabinet card can render without touching pgcrypto).

import { getDbPool } from '@/lib/db/pool'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type HiddenSlotSummary = {
  slotId: string
  startAt: string // ISO UTC
  endAt: string // ISO UTC
  durationMinutes: number
  // Plural conflicts are common (a single slot slot_overlaps several
  // foreign events). We return the count, plus the first conflict's
  // (external_calendar_id, external_event_id) so the drilldown route
  // can render an inline hint or open the source.
  conflictCount: number
  firstConflictExternalCalendarId: string | null
  firstConflictExternalEventId: string | null
}

const DEFAULT_WINDOW_DAYS = 30

export async function listHiddenSlotsForTeacher(opts: {
  teacherAccountId: string
  windowDays?: number
}): Promise<HiddenSlotSummary[]> {
  if (!UUID_PATTERN.test(opts.teacherAccountId)) return []
  const windowDays = Math.max(1, Math.min(opts.windowDays ?? DEFAULT_WINDOW_DAYS, 60))

  const pool = getDbPool()
  // BCS-G retro Codex round 1 WARN #4 — mirror the booking-side gate
  // predicate exactly. `lib/scheduling/slots/booking.ts:BUSY_OVERLAP_GATE_SQL`
  // only blocks bookings when the teacher's integration is
  // `sync_state='active'` AND `last_pulled_at >= now() - interval '10 minutes'`
  // (the freshness TTL). Counting overlaps under `degraded` / stale
  // / `disconnected` would surface "hidden slots" that learners can
  // actually still book → false alarm in the teacher UI.
  const result = await pool.query(
    `with slot_overlaps as (
       select s.id as slot_id,
              s.start_at,
              s.duration_minutes,
              (s.start_at + (s.duration_minutes * interval '1 minute'))
                as end_at,
              b.external_calendar_id,
              b.external_event_id,
              b.start_at as b_start_at
         from lesson_slots s
         join teacher_external_busy_intervals b
           on b.teacher_account_id = s.teacher_account_id
         join teacher_calendar_integrations tci
           on tci.account_id = s.teacher_account_id
          and tci.sync_state = 'active'
          and tci.last_pulled_at >= now() - interval '10 minutes'
        where s.teacher_account_id = $1
          and s.status = 'open'
          and s.start_at > now()
          and s.start_at < now() + ($2::int * interval '1 day')
          and b.is_own_event = false
          and s.start_at < b.end_at
          and (s.start_at + (s.duration_minutes * interval '1 minute'))
                > b.start_at
     ),
     aggregated as (
       select slot_id,
              start_at,
              end_at,
              duration_minutes,
              count(*)::int as conflict_count,
              (array_agg(external_calendar_id order by b_start_at asc))[1]
                as first_cal_id,
              (array_agg(external_event_id order by b_start_at asc))[1]
                as first_event_id
         from slot_overlaps
        group by slot_id, start_at, end_at, duration_minutes
     )
     select * from aggregated
      order by start_at asc`,
    [opts.teacherAccountId, windowDays],
  )

  return result.rows.map((row) => ({
    slotId: String(row.slot_id),
    startAt: new Date(String(row.start_at)).toISOString(),
    endAt: new Date(String(row.end_at)).toISOString(),
    durationMinutes: Number(row.duration_minutes),
    conflictCount: Number(row.conflict_count),
    firstConflictExternalCalendarId:
      row.first_cal_id === null ? null : String(row.first_cal_id),
    firstConflictExternalEventId:
      row.first_event_id === null ? null : String(row.first_event_id),
  }))
}

export async function countHiddenSlotsForTeacher(
  teacherAccountId: string,
): Promise<number> {
  if (!UUID_PATTERN.test(teacherAccountId)) return 0
  const pool = getDbPool()
  // BCS-G retro Codex round 1 WARN #4 — same booking-side gate.
  const result = await pool.query(
    `select count(distinct s.id)::int as n
       from lesson_slots s
       join teacher_external_busy_intervals b
         on b.teacher_account_id = s.teacher_account_id
       join teacher_calendar_integrations tci
         on tci.account_id = s.teacher_account_id
        and tci.sync_state = 'active'
        and tci.last_pulled_at >= now() - interval '10 minutes'
      where s.teacher_account_id = $1
        and s.status = 'open'
        and s.start_at > now()
        and s.start_at < now() + interval '30 days'
        and b.is_own_event = false
        and s.start_at < b.end_at
        and (s.start_at + (s.duration_minutes * interval '1 minute'))
              > b.start_at`,
    [teacherAccountId],
  )
  return Number(result.rows[0]?.n ?? 0)
}
