// BCS-F.1 — post-pull conflict detector.
//
// After the pull-worker (BCS-D.2a) rewrites
// `teacher_external_busy_intervals` for a teacher, this module
// reconciles the booked slots against the new busy set:
//
//   - For every `booked` slot of the teacher whose [start_at,
//     start_at + duration) overlaps a busy interval that is NOT
//     own_event AND NOT orphan_self → stamp `external_conflict_at =
//     now()`, `external_conflict_kind = 'post_book_overlap'`,
//     `conflict_source_(calendar|event)_id`. If a slot already has
//     a conflict pointing at the SAME source — leave the stamp
//     unchanged (don't churn updated_at unnecessarily).
//
//   - For every `booked` slot of the teacher whose existing
//     conflict_source no longer matches an overlapping busy
//     interval → clear the conflict (`external_conflict_at = null`,
//     `external_conflict_kind = null`, `conflict_source_* = null`).
//
// Multiple overlaps for the same slot: pick ONE deterministically
// (earliest busy.start_at, then external_event_id lex). The "+N
// other conflicts" surface (plan §4.7) will use a per-request
// endpoint that recomputes the full overlap set live.
//
// Plan §3.1 + §4.7. F8 ownership rule — own_event filtered out so
// our own echoed events don't show as conflicts. Orphan-self filtered
// out so post-reconnect stragglers surface via the F8 UI, not as a
// false post-book conflict.

import { getDbPool } from '@/lib/db/pool'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type RunConflictDetectionOutcome = {
  teacherAccountId: string
  scanned: number
  conflictsStamped: number
  conflictsCleared: number
  conflictsUnchanged: number
}

export async function runConflictDetectionForTeacher(opts: {
  teacherAccountId: string
}): Promise<
  | { ok: true; outcome: RunConflictDetectionOutcome }
  | { ok: false; error: 'invalid_account' }
> {
  if (!UUID_PATTERN.test(opts.teacherAccountId)) {
    return { ok: false, error: 'invalid_account' }
  }

  const pool = getDbPool()

  // Read all currently-booked slots of this teacher AND their current
  // conflict-stamp triple (so we can avoid updates when nothing
  // changed).
  const slotsResult = await pool.query(
    `select id, start_at, duration_minutes,
            external_conflict_at, conflict_source_calendar_id,
            conflict_source_event_id
       from lesson_slots
      where teacher_account_id = $1
        and status = 'booked'
        and start_at > now()`,
    [opts.teacherAccountId],
  )

  const outcome: RunConflictDetectionOutcome = {
    teacherAccountId: opts.teacherAccountId,
    scanned: slotsResult.rows.length,
    conflictsStamped: 0,
    conflictsCleared: 0,
    conflictsUnchanged: 0,
  }

  for (const row of slotsResult.rows) {
    const slotId = String(row.id)
    const startAt = new Date(String(row.start_at)).toISOString()
    const duration = Number(row.duration_minutes)
    const currentConflictAt = row.external_conflict_at
      ? new Date(String(row.external_conflict_at)).toISOString()
      : null
    const currentCalId = row.conflict_source_calendar_id
      ? String(row.conflict_source_calendar_id)
      : null
    const currentEventId = row.conflict_source_event_id
      ? String(row.conflict_source_event_id)
      : null

    // Find the deterministic "primary" overlapping busy interval (if
    // any). Earliest start, then lex on external_event_id for
    // stability. Filter out own_event + orphan_self.
    const overlap = await pool.query(
      `select external_calendar_id, external_event_id
         from teacher_external_busy_intervals
        where teacher_account_id = $1
          and is_own_event = false
          and is_orphan_self = false
          and tstzrange(start_at, end_at, '[)')
              && tstzrange(
                $2::timestamptz,
                $2::timestamptz + ($3 || ' minutes')::interval,
                '[)'
              )
        order by start_at asc, external_event_id asc
        limit 1`,
      [opts.teacherAccountId, startAt, duration],
    )

    if (overlap.rows.length === 0) {
      // No overlap: clear any existing conflict stamp.
      if (currentConflictAt !== null) {
        await pool.query(
          `update lesson_slots
              set external_conflict_at = null,
                  external_conflict_kind = null,
                  conflict_source_calendar_id = null,
                  conflict_source_event_id = null,
                  updated_at = now()
            where id = $1`,
          [slotId],
        )
        outcome.conflictsCleared++
      } else {
        outcome.conflictsUnchanged++
      }
      continue
    }

    const calId = String(overlap.rows[0].external_calendar_id)
    const eventId = String(overlap.rows[0].external_event_id)

    if (
      currentConflictAt !== null
      && currentCalId === calId
      && currentEventId === eventId
    ) {
      // Same conflict already stamped — no-op (don't churn updated_at).
      outcome.conflictsUnchanged++
      continue
    }

    // Stamp / re-stamp the conflict.
    await pool.query(
      `update lesson_slots
          set external_conflict_at = now(),
              external_conflict_kind = 'post_book_overlap',
              conflict_source_calendar_id = $2,
              conflict_source_event_id = $3,
              updated_at = now()
        where id = $1`,
      [slotId, calId, eventId],
    )
    outcome.conflictsStamped++
  }

  return { ok: true, outcome }
}

// Live overlap list for a single booked slot. Used by the per-request
// endpoint that powers the "+N other conflicts" picker in F.4 UI.
// Returns ALL overlapping foreign busy intervals (excludes own_event +
// orphan_self), ordered deterministically.
export async function listConflictsForSlot(opts: {
  slotId: string
}): Promise<{
  slot: { id: string; teacherAccountId: string; startAt: string; durationMinutes: number } | null
  overlaps: Array<{
    externalCalendarId: string
    externalEventId: string
    startAt: string
    endAt: string
    isWritableInSource: boolean
  }>
}> {
  if (!UUID_PATTERN.test(opts.slotId)) return { slot: null, overlaps: [] }
  const pool = getDbPool()
  const slotResult = await pool.query(
    `select id, teacher_account_id, start_at, duration_minutes
       from lesson_slots where id = $1`,
    [opts.slotId],
  )
  if (slotResult.rows.length === 0) return { slot: null, overlaps: [] }
  const slot = slotResult.rows[0]
  const teacherAccountId = String(slot.teacher_account_id)
  const startAt = new Date(String(slot.start_at)).toISOString()
  const duration = Number(slot.duration_minutes)

  const overlapResult = await pool.query(
    `select external_calendar_id, external_event_id, start_at, end_at,
            is_writable_in_source
       from teacher_external_busy_intervals
      where teacher_account_id = $1
        and is_own_event = false
        and is_orphan_self = false
        and tstzrange(start_at, end_at, '[)')
            && tstzrange(
              $2::timestamptz,
              $2::timestamptz + ($3 || ' minutes')::interval,
              '[)'
            )
      order by start_at asc, external_event_id asc`,
    [teacherAccountId, startAt, duration],
  )

  return {
    slot: {
      id: String(slot.id),
      teacherAccountId,
      startAt,
      durationMinutes: duration,
    },
    overlaps: overlapResult.rows.map((r) => ({
      externalCalendarId: String(r.external_calendar_id),
      externalEventId: String(r.external_event_id),
      startAt: new Date(String(r.start_at)).toISOString(),
      endAt: new Date(String(r.end_at)).toISOString(),
      isWritableInSource: Boolean(r.is_writable_in_source),
    })),
  }
}
