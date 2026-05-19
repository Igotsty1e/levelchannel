// BCS-DEF-2 — admin /admin/slots/conflicts feed helpers.
//
// Plan: docs/plans/conflict-feed.md §3.1 + §3.6 + §4.2 (round-3
// SIGN-OFF, 2026-05-19).
//
// Three exports:
//
//   * listAdminConflicts({ since }) — server-side read for the
//     dashboard. Filters `status='booked'` per §0a closure (detector
//     only stamps booked) + 30-day window default. Joins
//     teacher/learner emails for the row chrome.
//
//   * countAdminConflicts({ since }) — badge count on /admin/slots.
//     Same filter as the list (status='booked' + window). Returns
//     null on any DB error so the link still renders without the
//     badge.
//
//   * isAuditTablePresent() — explicit migration-pending probe for
//     the page banner. Reads `information_schema.tables`. NO
//     CACHING (round-2 WARN#4 closure) — process-wide memoization
//     would survive the migration flip and leave the banner stuck
//     visible. Plain pool.query() per call.
//
//   * runCancelFromConflictCleanup({ slotId, ... }) — the awaited
//     post-commit cleanup TX used by the cancel route when
//     `fromConflict===true`. Owns its own client + BEGIN/COMMIT +
//     SAVEPOINT around the audit INSERT for 42P01 recovery. Errors
//     swallowed inside the helper (logged warn); the cancel route's
//     response is driven by `cancelSlot()` outcome only. Round-1
//     WARN#5 + round-2 WARN#3 closure.

import { isUndefinedTableError } from '@/lib/db/errors'
import { getDbPool } from '@/lib/db/pool'

export type AdminConflict = {
  slotId: string
  teacherAccountId: string
  teacherEmail: string
  learnerAccountId: string | null
  learnerEmail: string | null
  tariffId: string | null
  status: 'booked'
  startAt: string
  durationMinutes: number
  externalConflictAt: string
  externalConflictKind: string | null
  conflictSourceCalendarId: string | null
  conflictSourceEventId: string | null
}

export type AdminConflictsListOpts = {
  /**
   * Lower bound on `external_conflict_at`. Pass `null` for all-time
   * (used when the page URL carries `?window=all`). Defaults to
   * 30 days ago at the page layer.
   */
  since: Date | null
}

const DEFAULT_LIMIT = 200

/**
 * §3.1 read. Joins teacher + (optional) learner emails. Filters
 * `status='booked'` because the detector only stamps booked slots
 * (`lib/calendar/conflict-detector.ts:62-64`). Includes a defensive
 * `external_conflict_at is not null` because the partial index
 * predicate is the security net against query-planner regressions.
 */
export async function listAdminConflicts(
  opts: AdminConflictsListOpts,
): Promise<AdminConflict[]> {
  const pool = getDbPool()
  const sinceParam = opts.since ? opts.since.toISOString() : null
  const result = await pool.query(
    `select s.id,
            s.teacher_account_id,
            s.learner_account_id,
            s.tariff_id,
            s.status,
            s.start_at,
            s.duration_minutes,
            s.external_conflict_at,
            s.external_conflict_kind,
            s.conflict_source_calendar_id,
            s.conflict_source_event_id,
            t.email as teacher_email,
            l.email as learner_email
       from lesson_slots s
       join accounts t on t.id = s.teacher_account_id
       left join accounts l on l.id = s.learner_account_id
      where s.external_conflict_at is not null
        and s.status = 'booked'
        and ($1::timestamptz is null or s.external_conflict_at > $1::timestamptz)
      order by s.external_conflict_at desc
      limit $2`,
    [sinceParam, DEFAULT_LIMIT],
  )

  return result.rows.map((row) => ({
    slotId: String(row.id),
    teacherAccountId: String(row.teacher_account_id),
    teacherEmail: String(row.teacher_email ?? ''),
    learnerAccountId: row.learner_account_id
      ? String(row.learner_account_id)
      : null,
    learnerEmail: row.learner_email ? String(row.learner_email) : null,
    tariffId: row.tariff_id ? String(row.tariff_id) : null,
    status: 'booked' as const,
    startAt: new Date(String(row.start_at)).toISOString(),
    durationMinutes: Number(row.duration_minutes),
    externalConflictAt: new Date(String(row.external_conflict_at)).toISOString(),
    externalConflictKind: row.external_conflict_kind
      ? String(row.external_conflict_kind)
      : null,
    conflictSourceCalendarId: row.conflict_source_calendar_id
      ? String(row.conflict_source_calendar_id)
      : null,
    conflictSourceEventId: row.conflict_source_event_id
      ? String(row.conflict_source_event_id)
      : null,
  }))
}

/**
 * §3.6 badge count. `status='booked'` filter is load-bearing —
 * `cancelSlot()` doesn't clear `external_conflict_at` and the detector
 * ignores cancelled slots, so without this filter cancelled-stamped
 * rows would inflate the badge forever (round-1 BLOCKER#3).
 *
 * Returns `null` on ANY error so the parent page can render the link
 * without a count and not crash (§3.6 closure).
 */
export async function countAdminConflicts(
  opts: AdminConflictsListOpts,
): Promise<number | null> {
  try {
    const pool = getDbPool()
    const sinceParam = opts.since ? opts.since.toISOString() : null
    const result = await pool.query(
      `select count(*)::int as n
         from lesson_slots
        where external_conflict_at is not null
          and status = 'booked'
          and ($1::timestamptz is null or external_conflict_at > $1::timestamptz)`,
      [sinceParam],
    )
    const n = Number(result.rows[0]?.n ?? 0)
    return Number.isFinite(n) ? n : null
  } catch (err) {
    console.warn('[admin.countAdminConflicts] read failed', {
      err: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}

/**
 * §3.5 explicit migration-pending probe.
 *
 * Plain `information_schema.tables` lookup against the current schema.
 * Returns false if the table is missing OR the probe itself errors
 * (defensive — if we can't even probe, render the banner so the
 * operator knows something is off).
 *
 * **NO CACHING.** Round-2 WARN#4 closure: process-wide memoization
 * would survive the deploy-before-migrate flip and leave the banner
 * visible for the entire process lifetime after the migration ran.
 * Plain `pool.query()` per page render; no module-level cache, no
 * `unstable_cache`, no `React.cache` wrapper.
 */
export async function isAuditTablePresent(): Promise<boolean> {
  try {
    const pool = getDbPool()
    const result = await pool.query(
      `select 1
         from information_schema.tables
        where table_schema = current_schema()
          and table_name = 'slot_admin_actions'
        limit 1`,
    )
    return result.rows.length > 0
  } catch (err) {
    console.warn('[admin.isAuditTablePresent] probe failed', {
      err: err instanceof Error ? err.message : String(err),
    })
    return false
  }
}

export type CancelFromConflictCleanupOpts = {
  slotId: string
  operatorAccountId: string
  reason: string
  payload: Record<string, unknown>
}

/**
 * §3.4 awaited post-commit cleanup TX for cancel-from-conflict.
 *
 * AFTER `cancelSlot()` returns truthy AND the request body carries
 * `fromConflict===true`, the cancel route awaits this helper. The
 * cancel itself has already committed in `cancelSlot()`; this helper
 * does TWO things in one fresh client TX:
 *
 *   1. Clear the 4 conflict columns on the now-cancelled row (so it
 *      stops polluting the dashboard's badge query + partial index).
 *   2. Insert the `slot_admin_actions` audit row with
 *      `action='cancel-from-conflict'`.
 *
 * Audit INSERT is wrapped in `SAVEPOINT before_audit` — 42P01
 * (table missing during deploy-before-migrate) is recovered via
 * `ROLLBACK TO SAVEPOINT`, the TX continues, and the stamp-clearing
 * UPDATE still commits. Any other error from the audit INSERT
 * re-throws → the WHOLE cleanup TX rolls back → the stamp stays on
 * the cancelled row (transient; the `status='booked'` filter in the
 * badge + list query excludes it from the UI anyway).
 *
 * Errors swallowed at the outermost level (logged warn). The cancel
 * route's response is driven by `cancelSlot()` outcome only. Round-1
 * WARN#5 + round-2 WARN#3 closure.
 */
export async function runCancelFromConflictCleanup(
  opts: CancelFromConflictCleanupOpts,
): Promise<void> {
  const pool = getDbPool()
  const cleanupClient = await pool.connect()
  try {
    await cleanupClient.query('begin')

    // Step 1 — clear the 4 conflict columns on the cancelled row.
    // Defensive WHERE: `status='cancelled'` so we don't accidentally
    // null a stamp on a still-booked row (paranoid; cancelSlot just
    // committed its UPDATE, but mid-flight races with a teacher
    // dismiss/uncancel are conceivable).
    await cleanupClient.query(
      `update lesson_slots
          set external_conflict_at = null,
              external_conflict_kind = null,
              conflict_source_calendar_id = null,
              conflict_source_event_id = null,
              updated_at = now()
        where id = $1
          and status = 'cancelled'`,
      [opts.slotId],
    )

    // Step 2 — write the secondary audit row inside a SAVEPOINT so
    // 42P01 (deploy-before-migrate window) is recoverable.
    try {
      await cleanupClient.query('savepoint before_audit')
      await cleanupClient.query(
        `insert into slot_admin_actions
           (slot_id, operator_account_id, action, reason, payload)
         values ($1, $2, 'cancel-from-conflict', $3, $4::jsonb)`,
        [
          opts.slotId,
          opts.operatorAccountId,
          opts.reason,
          JSON.stringify(opts.payload ?? {}),
        ],
      )
      await cleanupClient.query('release savepoint before_audit')
    } catch (auditErr) {
      if (isUndefinedTableError(auditErr)) {
        await cleanupClient
          .query('rollback to savepoint before_audit')
          .catch(() => {})
        console.warn(
          '[admin.cancel-from-conflict] migration 0062 pending — audit row skipped',
          { slotId: opts.slotId },
        )
      } else {
        // Re-throw to abort the WHOLE cleanup TX. Outer try/catch
        // logs + swallows — the cancel route still returns 200.
        throw auditErr
      }
    }

    await cleanupClient.query('commit')
  } catch (err) {
    await cleanupClient.query('rollback').catch(() => {})
    console.warn('[admin.cancel-from-conflict] post-commit cleanup failed', {
      slotId: opts.slotId,
      err: err instanceof Error ? err.message : String(err),
    })
  } finally {
    cleanupClient.release()
  }
}
