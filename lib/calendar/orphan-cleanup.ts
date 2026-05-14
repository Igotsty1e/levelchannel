// BCS-G.4 — Orphan-self cleanup (plan §4.12 reconnect drift).
//
// After a teacher disconnects + reconnects their Google integration,
// `teacher_calendar_integrations.epoch` rotates. Slots that were
// pushed under the OLD epoch keep their stale `external_event_id`
// + `integration_epoch` (matches the F8 ownership stamp convention —
// the reconciler's `orphan_self` outcome leaves the binding intact
// so a teacher action can resolve it).
//
// This module surfaces those orphan-self slots to the teacher in
// `/teacher/settings/calendar`, and exposes a single bulk action
// — "Ignore" — that NULL-s the local binding so the slot stops
// pointing at the dead event. Removing the event from Google's
// side itself is a teacher-side responsibility (the calendar is
// theirs to manage) — we don't enqueue a delete here because the
// new integration session doesn't own the old write calendar, and
// trying to delete cross-session is more likely to ratrace than
// help.
//
// Predicate for "orphan-self":
//   - external_event_id IS NOT NULL (binding present), AND
//   - integration_epoch IS NOT NULL (we know which epoch it came
//     from — pre-Phase-1 bindings without epoch are out of scope),
//     AND
//   - integration_epoch != tci.epoch (the integration's CURRENT
//     epoch differs — i.e. the teacher reconnected since).
//
// Status filter:
//   - status IN ('booked', 'open', 'cancelled') — all three can
//     carry a stale binding. We surface them all; the operator
//     decides per-row whether to ignore (NULL the binding) or
//     leave it for the next reconcile pass.

import { getDbPool } from '@/lib/db/pool'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type OrphanSlotRow = {
  slotId: string
  startAt: string // ISO UTC
  durationMinutes: number
  status: string
  externalCalendarId: string
  externalEventId: string
  staleEpoch: string
}

export async function listOrphanSelfSlotsForTeacher(
  teacherAccountId: string,
): Promise<OrphanSlotRow[]> {
  if (!UUID_PATTERN.test(teacherAccountId)) return []
  const pool = getDbPool()
  const r = await pool.query(
    `select s.id,
            s.start_at,
            s.duration_minutes,
            s.status,
            s.external_calendar_id,
            s.external_event_id,
            s.integration_epoch
       from lesson_slots s
       join teacher_calendar_integrations tci
         on tci.account_id = s.teacher_account_id
      where s.teacher_account_id = $1
        and s.external_event_id is not null
        and s.integration_epoch is not null
        and s.integration_epoch <> tci.epoch
      order by s.start_at asc`,
    [teacherAccountId],
  )
  return r.rows.map((row) => ({
    slotId: String(row.id),
    startAt: new Date(String(row.start_at)).toISOString(),
    durationMinutes: Number(row.duration_minutes),
    status: String(row.status),
    externalCalendarId: String(row.external_calendar_id),
    externalEventId: String(row.external_event_id),
    staleEpoch: String(row.integration_epoch),
  }))
}

export type IgnoreOrphanOutcome =
  | { ok: true; ignored: number }
  | { ok: false; reason: 'no_match' }

// Best-effort bulk ignore. Refuses to touch a row whose stale binding
// has already been cleared OR whose epoch matches the CURRENT
// integration (i.e. the teacher reconnected to the SAME epoch — a
// no-op reconnect, the slot is fine). All-or-nothing isn't required;
// partial completion is fine, the operator can re-trigger.
//
// Returns the number of rows actually NULL-ed so the UI can tell the
// operator how many were already cleared.
export async function ignoreOrphanSelfSlot(opts: {
  teacherAccountId: string
  slotId: string
}): Promise<IgnoreOrphanOutcome> {
  if (!UUID_PATTERN.test(opts.teacherAccountId)) {
    return { ok: false, reason: 'no_match' }
  }
  if (!UUID_PATTERN.test(opts.slotId)) {
    return { ok: false, reason: 'no_match' }
  }
  const pool = getDbPool()
  const r = await pool.query(
    `update lesson_slots s
        set external_event_id = null,
            external_calendar_id = null,
            integration_epoch = null,
            last_reconciled_at = now()
       from teacher_calendar_integrations tci
      where s.id = $1
        and s.teacher_account_id = $2
        and tci.account_id = s.teacher_account_id
        and s.external_event_id is not null
        and s.integration_epoch is not null
        and s.integration_epoch <> tci.epoch
      returning s.id`,
    [opts.slotId, opts.teacherAccountId],
  )
  if (r.rowCount === 0) return { ok: false, reason: 'no_match' }
  return { ok: true, ignored: Number(r.rowCount) }
}

export async function ignoreAllOrphanSelfSlotsForTeacher(
  teacherAccountId: string,
): Promise<{ ignored: number }> {
  if (!UUID_PATTERN.test(teacherAccountId)) return { ignored: 0 }
  const pool = getDbPool()
  const r = await pool.query(
    `update lesson_slots s
        set external_event_id = null,
            external_calendar_id = null,
            integration_epoch = null,
            last_reconciled_at = now()
       from teacher_calendar_integrations tci
      where s.teacher_account_id = $1
        and tci.account_id = s.teacher_account_id
        and s.external_event_id is not null
        and s.integration_epoch is not null
        and s.integration_epoch <> tci.epoch
      returning s.id`,
    [teacherAccountId],
  )
  return { ignored: Number(r.rowCount ?? 0) }
}
