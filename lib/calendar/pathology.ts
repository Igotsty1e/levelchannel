// BCS-G.3 — Calendar pathology alert (plan §4.8 minor note 2,
// §G.3).
//
// The reconcile sweep (BCS-G.1) bumps `lesson_slots.cancel_repush_count`
// every time it re-enqueues a delete for a cancelled-but-still-on-
// Google slot. A single bump is normal (transient Google delay).
// A counter ≥ 3 over the slot's lifetime means the (delete succeeds
// → event resurrects → reconciler re-enqueues delete) loop is
// stable — that's pathological. The plan mandates an operator alert
// so the loop doesn't run silently for weeks.
//
// What's pathological:
//   - cancel_repush_count >= 3 (default threshold; env-tunable in
//     the cron script).
//   - status='cancelled' (we still want the event gone; an
//     accidentally-resurrected booked slot is a different bug).
//   - external_event_id IS NOT NULL (binding still intact — if the
//     reconciler had given up and unbound, the loop is broken,
//     no alert needed).
//
// What's NOT pathological:
//   - a slot with one repush — that's just normal "delete worker
//     hadn't run yet" timing.
//   - slots cleared by drift-resolution unbind — they no longer
//     match the predicate.
//   - slots whose teacher is disconnected — the reconciler filters
//     them, repush counter doesn't advance under that state.
//
// What this DOES NOT do:
//   - send the email (caller does, with cooldown);
//   - mutate state — pure read.

import { getDbPool } from '@/lib/db/pool'

export type PathologicalSlot = {
  slotId: string
  teacherAccountId: string
  startAt: string // ISO UTC
  externalCalendarId: string
  externalEventId: string
  cancelRepushCount: number
  lastReconciledAt: string | null
}

export type PathologyVerdict =
  | { kind: 'ok' }
  | {
      kind: 'alert'
      count: number
      offenders: PathologicalSlot[]
      threshold: number
    }

const DEFAULT_THRESHOLD = 3
const DEFAULT_LIMIT_FOR_REPORT = 10

export async function listPathologicalSlots(opts?: {
  threshold?: number
  limit?: number
}): Promise<PathologicalSlot[]> {
  const threshold = Math.max(1, opts?.threshold ?? DEFAULT_THRESHOLD)
  const limit = Math.max(1, Math.min(opts?.limit ?? DEFAULT_LIMIT_FOR_REPORT, 100))
  const pool = getDbPool()
  const r = await pool.query(
    `select id,
            teacher_account_id,
            start_at,
            external_calendar_id,
            external_event_id,
            cancel_repush_count,
            last_reconciled_at
       from lesson_slots
      where status = 'cancelled'
        and external_event_id is not null
        and cancel_repush_count >= $1
      order by cancel_repush_count desc, start_at asc
      limit $2`,
    [threshold, limit],
  )
  return r.rows.map((row) => ({
    slotId: String(row.id),
    teacherAccountId: String(row.teacher_account_id),
    startAt: new Date(String(row.start_at)).toISOString(),
    externalCalendarId: String(row.external_calendar_id),
    externalEventId: String(row.external_event_id),
    cancelRepushCount: Number(row.cancel_repush_count),
    lastReconciledAt:
      row.last_reconciled_at === null
        ? null
        : new Date(String(row.last_reconciled_at)).toISOString(),
  }))
}

// Pure decision logic, exported so the cron script + tests can reuse
// it without touching Postgres or Resend.
export function decideVerdict(opts: {
  offenders: PathologicalSlot[]
  threshold?: number
}): PathologyVerdict {
  const threshold = opts.threshold ?? DEFAULT_THRESHOLD
  if (opts.offenders.length === 0) return { kind: 'ok' }
  // Defensive — the SELECT already filters by threshold; this guards
  // against an unfiltered input being passed.
  const filtered = opts.offenders.filter(
    (s) => s.cancelRepushCount >= threshold,
  )
  if (filtered.length === 0) return { kind: 'ok' }
  return {
    kind: 'alert',
    count: filtered.length,
    offenders: filtered,
    threshold,
  }
}

export async function evaluatePathology(opts?: {
  threshold?: number
  limit?: number
}): Promise<PathologyVerdict> {
  const offenders = await listPathologicalSlots(opts)
  return decideVerdict({ offenders, threshold: opts?.threshold })
}
