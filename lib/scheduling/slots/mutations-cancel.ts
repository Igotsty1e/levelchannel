// Wave 39: cancel write paths extracted from slots.ts.
// Dynamically imports @/lib/billing/consumption per design v3 —
// preserved verbatim so the legacy fast path
// (BILLING_WAVE_ACTIVE !== 'true') still avoids loading billing
// modules entirely.

import { getDbPool } from '@/lib/db/pool'
import { getLearnerCancelWindowHours } from '@/lib/scheduling/policy'

import {
  MAX_REASON_LEN,
  SLOT_COLUMNS,
  UUID_PATTERN,
  appendEventSql,
  rowToSlot,
} from './internal'
import type {
  CancelLearnerSlotResult,
  CancelTeacherSlotResult,
  LessonSlot,
} from './types'

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
  // Billing wave PR 1: same tx wrap as cancelLearnerSlot. Restore
  // package unit on success; restore is idempotent + no-op for
  // postpaid slots.
  const client = await pool.connect()
  try {
    await client.query('begin')
    const result = await client.query(
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
    if (result.rows[0]) {
      const { restorePackageConsumption } = await import('@/lib/billing/consumption')
      await restorePackageConsumption(client, {
        slotId,
        actor,
        reason: 'admin_or_learner_cancel',
      })
      await client.query('commit')
      return rowToSlot(result.rows[0])
    }
    await client.query('rollback')
    return null
  } catch (e) {
    await client.query('rollback').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}

// Codex 2026-05-07 #3 — race-safe learner cancel.
//
// Was: route called `getSlotById` → `canLearnerCancel` → `cancelSlot`.
// Three round-trips, two TOCTOU windows: between read and decision the
// status could flip to `completed`/`no_show_*`; between decision and
// UPDATE the 24-hour boundary could slip. The UPDATE in `cancelSlot`
// allowed ANY status except already-cancelled to flip to cancelled —
// so a `completed` row could be retroactively rewritten as cancelled.
//
// Now: ownership + status + 24-hour rule live in the WHERE clause of a
// single UPDATE. The DB invariant is the security boundary; the route
// just disambiguates the failure reason for UX.
//
// Disambiguation: on 0 rows, fetch the row state and classify why the
// UPDATE matched nothing. The classification is for UX only — the
// authoritative decision was already made by the UPDATE.
export async function cancelLearnerSlot(
  slotId: string,
  learnerAccountId: string,
  reason: string | null,
): Promise<CancelLearnerSlotResult> {
  if (!UUID_PATTERN.test(slotId)) return { ok: false, reason: 'not_found' }
  if (reason && reason.length > MAX_REASON_LEN) {
    throw new Error('slot/cancellationReason/too_long')
  }
  const pool = getDbPool()
  // Billing wave PR 1: wrap cancel + restore in a single tx so a
  // failed restore rolls back the cancellation. Restore is idempotent
  // and a no-op for postpaid slots; cheap to call unconditionally.
  const client = await pool.connect()
  let cancelledRow: Record<string, unknown> | null = null
  try {
    await client.query('begin')
    // POLICY-KNOBS (2026-05-17) — the 24-hour gate is env-tunable
    // via LEARNER_CANCEL_WINDOW_HOURS. Read on every invocation;
    // no module-scope memoization.
    const cancelWindowHours = getLearnerCancelWindowHours()
    const result = await client.query(
      `update lesson_slots
          set status = 'cancelled',
              cancelled_at = now(),
              cancelled_by_account_id = $2,
              cancellation_reason = $3,
              updated_at = now(),
              events = $4::jsonb || events
        where id = $1
          and learner_account_id = $2
          and status = 'booked'
          and start_at - now() >= make_interval(hours => $5::int)
        returning ${SLOT_COLUMNS}`,
      [
        slotId,
        learnerAccountId,
        reason,
        appendEventSql('slot.cancelled', 'learner', {
          cancelledByAccountId: learnerAccountId,
          reason,
        }),
        cancelWindowHours,
      ],
    )
    if (result.rows[0]) {
      const { restorePackageConsumption } = await import('@/lib/billing/consumption')
      await restorePackageConsumption(client, {
        slotId,
        actor: 'learner',
        reason: 'learner_cancel',
      })
      await client.query('commit')
      cancelledRow = result.rows[0]
    } else {
      await client.query('rollback')
    }
  } catch (e) {
    await client.query('rollback').catch(() => {})
    throw e
  } finally {
    client.release()
  }
  if (cancelledRow) {
    return { ok: true, slot: rowToSlot(cancelledRow) }
  }

  // The atomic UPDATE matched nothing — classify why for UX. Any
  // re-read here can drift from the moment the UPDATE evaluated, but
  // that drift only affects the error message, not the authority.
  const lookup = await pool.query(
    `select id, learner_account_id, status, start_at
       from lesson_slots
      where id = $1`,
    [slotId],
  )
  const row = lookup.rows[0]
  if (!row) return { ok: false, reason: 'not_found' }
  if (String(row.learner_account_id ?? '') !== learnerAccountId) {
    return { ok: false, reason: 'not_owner' }
  }
  if (String(row.status) !== 'booked') {
    return { ok: false, reason: 'already_terminal' }
  }
  const startMs = new Date(String(row.start_at)).getTime()
  const diffMs = Number.isNaN(startMs)
    ? -Infinity
    : startMs - Date.now()
  return {
    ok: false,
    reason: 'too_late_to_cancel',
    minutesUntilStart: Math.max(0, Math.floor(diffMs / 60_000)),
  }
}

// Wave C — teacher-owned cancel. Allows BOTH `open` AND `booked`
// teacher-owned slots to be cancelled. `reason` is REQUIRED for
// booked (a learner is being told their lesson is off — they
// deserve a reason in the audit trail) and optional for open (no
// learner involved). Atomic UPDATE WHERE teacher_account_id =
// session AND status IN ('open','booked') keeps ownership and
// status invariants in the SQL. Codex 2026-05-08 prescription.
//
// Refund / paid-allocation reconciliation is INTENTIONALLY NOT
// triggered here. Per Codex Wave C design: cancellation and
// refund are different domains; if the slot has a paid allocation,
// it leaves an operator follow-up trail (existing payment_allocations
// row + audit event) and the operator handles the refund manually
// in CloudPayments dashboard. Same posture as existing learner
// cancel of paid slots.
export async function cancelSlotByTeacher(
  slotId: string,
  teacherAccountId: string,
  reason: string | null,
): Promise<CancelTeacherSlotResult> {
  if (!UUID_PATTERN.test(slotId)) return { ok: false, reason: 'not_found' }
  if (!UUID_PATTERN.test(teacherAccountId)) {
    return { ok: false, reason: 'not_found' }
  }
  if (reason && reason.length > MAX_REASON_LEN) {
    throw new Error('slot/cancellationReason/too_long')
  }
  const pool = getDbPool()
  // Codex 2026-05-08 review fix: the reason-required-for-booked
  // invariant lives INSIDE the UPDATE predicate so the booked-vs-
  // open race cannot bypass it.
  // Billing wave PR 1: wrap in tx + restore consumption on success.
  const client = await pool.connect()
  let cancelledRow: Record<string, unknown> | null = null
  try {
    await client.query('begin')
    const result = await client.query(
      `update lesson_slots
          set status = 'cancelled',
              cancelled_at = coalesce(cancelled_at, now()),
              cancelled_by_account_id = $2,
              cancellation_reason = $3,
              updated_at = now(),
              events = $4::jsonb || events
        where id = $1
          and teacher_account_id = $2
          and status in ('open', 'booked')
          and (status = 'open' or nullif(btrim($3), '') is not null)
        returning ${SLOT_COLUMNS}`,
      [
        slotId,
        teacherAccountId,
        reason,
        appendEventSql('slot.cancelled', 'teacher', {
          cancelledByAccountId: teacherAccountId,
          reason,
        }),
      ],
    )
    if (result.rows[0]) {
      const { restorePackageConsumption } = await import('@/lib/billing/consumption')
      await restorePackageConsumption(client, {
        slotId,
        actor: 'teacher',
        reason: 'teacher_cancel',
      })
      await client.query('commit')
      cancelledRow = result.rows[0]
    } else {
      await client.query('rollback')
    }
  } catch (e) {
    await client.query('rollback').catch(() => {})
    throw e
  } finally {
    client.release()
  }
  if (cancelledRow) {
    return { ok: true, slot: rowToSlot(cancelledRow) }
  }
  // Sniff to classify the no-op.
  const sniff = await pool.query(
    `select status, teacher_account_id from lesson_slots where id = $1`,
    [slotId],
  )
  if (sniff.rows.length === 0) return { ok: false, reason: 'not_found' }
  if (sniff.rows[0].teacher_account_id !== teacherAccountId) {
    return { ok: false, reason: 'not_owner' }
  }
  // Row exists, owned by teacher, but didn't update → either
  // already-terminal (cancelled / completed / no_show_*) or status
  // is `booked` and the reason was blank.
  if (
    sniff.rows[0].status === 'booked' &&
    (!reason || reason.trim() === '')
  ) {
    return { ok: false, reason: 'reason_required_for_booked' }
  }
  return { ok: false, reason: 'already_terminal' }
}
