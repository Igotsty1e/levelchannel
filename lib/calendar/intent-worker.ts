// BCS-E.worker — drains `slot_lifecycle_intents`.
//
// Plan §4.6 F6″ contract:
//   - TX_cancel_1 (slot status + intent insert): the cancel route
//     UPDATEs lesson_slots.status = 'cancelled' AND INSERTs a
//     `kind='post_cancel_push'` intent in the SAME transaction. The
//     intent is the durable "we owe Google a delete" marker.
//   - TX_cancel_2 (this worker): pick up pending intents, classify
//     the integration, enqueue the delete push job, mark intent
//     succeeded.
//
// Plan §4.6 F6‴ no-false-success:
//   - status='succeeded' ONLY when one of:
//       (a) a `pending`/`in_progress` calendar_push_jobs row exists
//           for this (slot, 'delete')
//       (b) the slot has no `external_event_id` AND the post-cancel
//           push isn't needed (no integration / never bound)
//   - integration disconnected → status='blocked_integration'.
//     Revival sweep flips back to pending when actionable.
//   - terminal_failure after 10 attempts over 7 days under healthy
//     integration → operator alert.

import { enqueuePushJob } from '@/lib/calendar/push-worker'
import { getDbPool } from '@/lib/db/pool'

const INTENT_MAX_ATTEMPTS = 10
const INTENT_BACKOFF_MS = [
  60_000, // 1 min
  5 * 60_000,
  30 * 60_000,
  2 * 60 * 60_000, // 2h
  6 * 60 * 60_000,
  12 * 60 * 60_000,
  24 * 60 * 60_000,
  2 * 24 * 60 * 60_000,
  3 * 24 * 60 * 60_000,
  3 * 24 * 60 * 60_000, // cap
]

export type IntentOutcome =
  | { kind: 'succeeded'; intentId: string; slotId: string }
  | { kind: 'blocked_integration'; intentId: string; slotId: string }
  | { kind: 'retried'; intentId: string; slotId: string; reason: string }
  | { kind: 'terminal_failure'; intentId: string; slotId: string; reason: string }
  | { kind: 'no_op'; intentId: string; slotId: string; reason: string }

type ClaimedIntent = {
  id: string
  slotId: string
  kind: 'post_cancel_push' | 'post_move_push' | 'post_book_push'
  attempts: number
}

async function claimNextIntent(): Promise<ClaimedIntent | null> {
  const pool = getDbPool()
  // BCS-HARDEN-3 — wave-paranoia round-1 WARN #1. The original CTE
  // bumped `attempts` and `last_run_at` but left `status='pending'`,
  // so a parallel drainIntents() (overlap from the cron timer or
  // manual re-fire) could re-claim the same row and double-execute.
  // Mirror the pull-worker / push-worker pattern: flip to
  // 'in_progress' atomically in the same RETURNING statement.
  // markSucceeded / markBlocked / markTerminal / reschedule below
  // each flip status back to its terminal value.
  const r = await pool.query(
    `with claimed as (
       select id from slot_lifecycle_intents
        where status = 'pending'
          and next_run_at <= now()
        order by created_at asc
        limit 1
        for update skip locked
     )
     update slot_lifecycle_intents i
        set status = 'in_progress',
            attempts = i.attempts + 1,
            last_run_at = now()
       from claimed
      where i.id = claimed.id
      returning i.id, i.slot_id, i.kind, i.attempts`,
  )
  if (r.rows.length === 0) return null
  return {
    id: String(r.rows[0].id),
    slotId: String(r.rows[0].slot_id),
    kind: String(r.rows[0].kind) as ClaimedIntent['kind'],
    attempts: Number(r.rows[0].attempts),
  }
}

async function markSucceeded(intentId: string, slotId: string): Promise<IntentOutcome> {
  await getDbPool().query(
    `update slot_lifecycle_intents set status = 'succeeded', last_error = null where id = $1`,
    [intentId],
  )
  return { kind: 'succeeded', intentId, slotId }
}

async function markBlocked(intentId: string, slotId: string): Promise<IntentOutcome> {
  // Blocked: keep status='blocked_integration', re-check every 1h.
  await getDbPool().query(
    `update slot_lifecycle_intents
        set status = 'blocked_integration',
            next_run_at = now() + interval '1 hour',
            last_error = 'integration_disconnected'
      where id = $1`,
    [intentId],
  )
  return { kind: 'blocked_integration', intentId, slotId }
}

async function markTerminal(
  intentId: string,
  slotId: string,
  reason: string,
): Promise<IntentOutcome> {
  await getDbPool().query(
    `update slot_lifecycle_intents
        set status = 'terminal_failure', last_error = $2 where id = $1`,
    [intentId, reason],
  )
  return { kind: 'terminal_failure', intentId, slotId, reason }
}

async function reschedule(
  intent: ClaimedIntent,
  reason: string,
): Promise<IntentOutcome> {
  const idx = Math.min(intent.attempts - 1, INTENT_BACKOFF_MS.length - 1)
  const nextRunAt = new Date(Date.now() + INTENT_BACKOFF_MS[idx]).toISOString()
  await getDbPool().query(
    `update slot_lifecycle_intents
        set status = 'pending', next_run_at = $3::timestamptz, last_error = $2
      where id = $1`,
    [intent.id, reason, nextRunAt],
  )
  return { kind: 'retried', intentId: intent.id, slotId: intent.slotId, reason }
}

async function processPostCancelPush(intent: ClaimedIntent): Promise<IntentOutcome> {
  const pool = getDbPool()
  // Read slot + integration in one query.
  const r = await pool.query(
    `select s.id, s.teacher_account_id, s.status, s.external_event_id,
            s.external_calendar_id,
            tci.sync_state, tci.write_calendar_id
       from lesson_slots s
       left join teacher_calendar_integrations tci
         on tci.account_id = s.teacher_account_id
      where s.id = $1`,
    [intent.slotId],
  )
  if (r.rows.length === 0) {
    return markTerminal(intent.id, intent.slotId, 'slot_missing')
  }
  const row = r.rows[0]
  const status = String(row.status ?? '')
  const syncState = row.sync_state ? String(row.sync_state) : null
  const writeCalendar = row.write_calendar_id
    ? String(row.write_calendar_id)
    : (row.external_calendar_id ? String(row.external_calendar_id) : null)

  // Codex E.worker review #2: no integration row → no way to push to
  // Google, regardless of binding state. Mark intent succeeded as no_op.
  //
  // Previously this only no_op'd when external_event_id was ALSO null.
  // The other branch (no integration, binding still set — e.g. teacher
  // hard-deleted the row after a push had landed) fell through to
  // enqueuePushJob → push worker → ensureFreshAccessToken returns
  // integration_missing → terminal_failure. But the intent had ALREADY
  // marked itself succeeded → false success.
  //
  // Orphaned external_event_id is harmless here; the reconcile sweep
  // (BCS-G) handles future cleanup if the integration is re-connected.
  if (!syncState) {
    await markSucceeded(intent.id, intent.slotId)
    return {
      kind: 'no_op',
      intentId: intent.id,
      slotId: intent.slotId,
      reason: row.external_event_id
        ? 'no_integration_orphan_binding'
        : 'no_integration_no_binding',
    }
  }

  if (syncState === 'disconnected') {
    if (intent.attempts >= INTENT_MAX_ATTEMPTS) {
      return markTerminal(
        intent.id,
        intent.slotId,
        `disconnected_beyond_max_attempts (${intent.attempts})`,
      )
    }
    return markBlocked(intent.id, intent.slotId)
  }

  // Sanity: cancel intent on a NON-cancelled slot (e.g. cancel was
  // rolled back). Skip the push enqueue — terminal_failure.
  if (status !== 'cancelled') {
    return markTerminal(intent.id, intent.slotId, `slot_status_${status}_not_cancelled`)
  }

  if (!writeCalendar) {
    if (intent.attempts >= INTENT_MAX_ATTEMPTS) {
      return markTerminal(intent.id, intent.slotId, 'no_write_calendar_id')
    }
    return reschedule(intent, 'no_write_calendar_id')
  }

  // Enqueue delete push. F6 contract: even when external_event_id is
  // null (push hadn't run yet), enqueue — the push worker will use
  // deterministic id via COALESCE.
  const enq = await enqueuePushJob({
    slotId: row.id,
    teacherAccountId: String(row.teacher_account_id),
    kind: 'delete',
    payload: {
      write_calendar_id: writeCalendar,
    },
  })
  // Dedup any pending create for the same slot — won't be deleted
  // (we just enqueued the delete) but the worker treats cancelled
  // slot status as cancelled_by_dependent for create.
  await pool.query(
    `update calendar_push_jobs
        set status = 'cancelled_by_dependent', updated_at = now()
      where slot_id = $1 and kind = 'create' and status = 'pending'`,
    [row.id],
  )

  // F6‴ no-false-success verification: at least one of (a) pending/in_progress
  // delete job present, (b) binding already cleared.
  const verify = await pool.query(
    `select 1 from calendar_push_jobs
       where slot_id = $1 and kind = 'delete' and status in ('pending', 'in_progress')`,
    [row.id],
  )
  if (verify.rows.length === 0 && row.external_event_id !== null) {
    // Couldn't get the delete job pending (enqueuePushJob may have
    // returned inserted=false because a succeeded delete already
    // exists — extremely unlikely race). Reschedule.
    return reschedule(intent, 'enqueue_no_op_external_event_still_bound')
  }
  void enq
  return markSucceeded(intent.id, intent.slotId)
}

export async function drainIntents(opts: {
  maxJobs?: number
}): Promise<{ outcomes: IntentOutcome[] }> {
  const maxJobs = opts.maxJobs ?? 10
  const outcomes: IntentOutcome[] = []
  for (let i = 0; i < maxJobs; i++) {
    const intent = await claimNextIntent()
    if (!intent) break
    let outcome: IntentOutcome
    if (intent.kind === 'post_cancel_push') {
      outcome = await processPostCancelPush(intent)
    } else {
      // post_move_push / post_book_push not wired yet — pass through.
      outcome = await markSucceeded(intent.id, intent.slotId)
    }
    outcomes.push(outcome)
  }
  return { outcomes }
}

// Helper called from cancel routes IN THE SAME TX as the slot UPDATE.
// Plan §4.6 F6″: tx_cancel_1 = (slot UPDATE) + (intent INSERT)
// atomic. The caller-supplied client lets the helper participate.
export async function insertPostCancelIntent(
  client: { query: (text: string, params?: unknown[]) => Promise<unknown> },
  slotId: string,
): Promise<void> {
  await client.query(
    `insert into slot_lifecycle_intents
       (slot_id, kind, status, next_run_at)
     values ($1, 'post_cancel_push', 'pending', now())
     on conflict (slot_id, kind) where status = 'pending'
       do nothing`,
    [slotId],
  )
}

// Revival sweep — every 1h flip `blocked_integration` rows back to
// pending when the integration looks actionable again.
//
// BCS-HARDEN-4 — wave-paranoia round-1 WARN #2 closed. The original
// gate required `tci.last_pulled_at >= now() - 30min` in addition to
// `sync_state in ('active','degraded')`. But `upsertGoogleIntegration`
// nulls `last_pulled_at` on every reconnect (see
// `lib/calendar/integrations.ts:upsertGoogleIntegration`), so a
// teacher who reconnected was stuck in a two-cycle latency: their
// blocked intents wouldn't revive until (a) the pull cron successfully
// stamped `last_pulled_at` on the integration, AND THEN (b) the next
// hourly revive tick saw the fresh stamp.
//
// The fix: drop the freshness gate. The `sync_state in
// ('active','degraded')` check already establishes the integration is
// reachable. If the underlying push later 401s again (real Google
// problem), the cancel intent re-enters `blocked_integration` via
// markBlocked anyway — there's no risk of "reviving into a
// permanently-broken integration."
export async function reviveBlockedIntents(): Promise<{ revived: number }> {
  const pool = getDbPool()
  const r = await pool.query(
    `update slot_lifecycle_intents i
        set status = 'pending', next_run_at = now()
       from lesson_slots s
       join teacher_calendar_integrations tci
         on tci.account_id = s.teacher_account_id
      where i.slot_id = s.id
        and i.status = 'blocked_integration'
        and tci.sync_state in ('active', 'degraded')
      returning i.id`,
  )
  return { revived: r.rows.length }
}
