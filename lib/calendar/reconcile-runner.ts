// BCS-G.1 — Bounded reconcile sweep (plan §4.8 F9″ active healer +
// F9‴ gated re-enqueue).
//
// What this runs (once per cron tick):
//
//   1. Pick up to N slots that have an external Google event bound
//      and a start_at inside the [-7d, +30d] window. Order so the
//      most-stale (last_reconciled_at NULLS FIRST) and the
//      cancelled-with-external rows come first.
//   2. For each row, fetch the integration's fresh access token,
//      call `events.get(external_calendar_id, external_event_id)`,
//      and apply the plan §4.8 state machine:
//
//        booked + 200 + epoch match    → healthy. Bump reconciled_at.
//        booked + 200 + epoch mismatch → orphan-self. LEAVE binding,
//                                        bump reconciled_at. F8′ UI
//                                        surfaces the row separately.
//        booked + 200 + status=cancelled (Google-side tombstone)
//                                      → treat as 404: NULL binding +
//                                        set external_sync_failed_at.
//        booked + 404/410              → NULL binding +
//                                        external_sync_failed_at.
//        cancelled + 200               → F9‴ gated re-enqueue delete.
//        cancelled + 404/410           → drift resolved. NULL binding,
//                                        no sync_failed flag (we wanted
//                                        the event gone).
//        any   + 401/403/429/5xx/net   → skip. DO NOT bump
//                                        reconciled_at — next sweep
//                                        will see the row sooner.
//
// F9‴ gate (cancelled + 200 — Google still has an event we asked to
// delete). Plan §4.8: probe the latest `calendar_push_jobs` row for
// (slot_id, kind='delete') and decide whether to re-enqueue:
//
//   - no prior job → enqueue.
//   - latest pending|in_progress → skip (worker is on it).
//   - latest succeeded → re-enqueue iff
//       now() - last_attempt_at > 6h
//     (covers operator-side re-creation of the event in Google).
//   - latest terminal_failure → re-enqueue iff
//       tci.last_reconnected_at > latest.last_attempt_at
//     (environment changed — the prior failure is no longer
//     load-bearing).
//   - latest cancelled_by_dependent → fresh enqueue.
//
// What this DOES NOT do (out of scope, by design):
//   - rate-budget across teachers — the bounded LIMIT 100 per sweep
//     plus the daily cron cadence is the budget;
//   - kick the push worker — `enqueuePushJob` flips a `pending` row,
//     the existing push-worker cron picks it up next tick;
//   - heal slots whose binding is already NULL (we have nothing
//     to compare against; F8′ UI handles orphan-self surface).
//
// Why "active healer" is a sweep and not a per-event reaction: the
// push/pull contour drops or skips events under transient HTTP errors
// + the integration-disconnect state. A daily sweep is the catch-net
// that re-derives the truth from Google directly, independent of any
// in-flight worker bug.

import {
  fetchEventById,
  type FetchEventOutcome,
} from '@/lib/calendar/google/pull'
import { getGoogleIntegration } from '@/lib/calendar/integrations'
import { enqueuePushJob } from '@/lib/calendar/push-worker'
import { withTokenRetry, type CallResult } from '@/lib/calendar/token-retry'
import { getDbPool } from '@/lib/db/pool'

const DEFAULT_LIMIT = 100
const REENQUEUE_AFTER_SUCCESS_MS = 6 * 60 * 60_000

export type ReconcileSlotOutcome =
  | { kind: 'healthy' }
  | { kind: 'orphan_self' }
  | { kind: 'unbound_after_drift_resolved' }
  | { kind: 'unbound_after_sync_failure' }
  | { kind: 'cancel_reenqueued' }
  | { kind: 'cancel_gate_skipped'; reason: CancelGateSkipReason }
  | { kind: 'skipped_rate_limited' }
  | { kind: 'skipped_server_error'; status: number }
  | { kind: 'skipped_auth_expired' }
  | { kind: 'skipped_forbidden' }
  | { kind: 'skipped_network'; message: string }
  | { kind: 'skipped_shape'; message: string }
  | { kind: 'skipped_integration_missing' }
  | { kind: 'skipped_integration_disconnected' }
  | { kind: 'skipped_token_refresh_failed'; reason: string }
  // Codex round 2 P2 — the slot row changed under us between
  // candidate selection and the guarded UPDATE. Outcome is benign;
  // the next sweep picks up the row in its new state.
  | { kind: 'skipped_state_changed' }
  // Codex round 5 P1 — cancelled-slot path: Google event exists at
  // the bound id but its ownership stamp does NOT match this slot.
  // SAFE behavior: unbind locally without enqueueing a delete (would
  // delete somebody else's event). No external_sync_failed_at — the
  // binding was corrupted, not "we expected delete to succeed".
  | { kind: 'unbound_after_drift_resolved_alien' }

export type CancelGateSkipReason =
  | 'inflight'
  | 'recent_success'
  | 'terminal_no_env_change'

export type CandidateSlot = {
  id: string
  teacherAccountId: string
  externalCalendarId: string
  externalEventId: string
  integrationEpoch: string | null
  status: 'booked' | 'cancelled'
}

export type ReconcileFetchImpl = (
  opts: Parameters<typeof fetchEventById>[0],
) => Promise<FetchEventOutcome>

export type ReconcileSweepResult = {
  picked: number
  outcomes: Record<string, number>
  details: Array<{ slotId: string; outcome: ReconcileSlotOutcome }>
}

const STATUS_SET = new Set(['booked', 'cancelled'])

export async function pickReconcileCandidates(
  limit: number = DEFAULT_LIMIT,
): Promise<CandidateSlot[]> {
  const pool = getDbPool()
  // Codex round 2 P1: JOIN against teacher_calendar_integrations and
  // filter to actionable sync_states. A disconnected teacher with
  // >limit bound slots in the window otherwise eats the whole sweep
  // budget every day while their slots can't actually be reconciled
  // (no fresh token, events.get would fail at auth_expired). Active
  // teachers would never make it into the batch under that load.
  const r = await pool.query(
    `select s.id,
            s.teacher_account_id,
            s.external_calendar_id,
            s.external_event_id,
            s.integration_epoch,
            s.status
       from lesson_slots s
       join teacher_calendar_integrations tci
         on tci.account_id = s.teacher_account_id
      where s.external_event_id is not null
        and s.external_calendar_id is not null
        and s.status in ('booked', 'cancelled')
        and tci.sync_state in ('active', 'degraded')
        and s.start_at > now() - interval '7 days'
        and s.start_at < now() + interval '30 days'
      -- Codex round 1 P2: NULLS FIRST on last_reconciled_at must come
      -- before start_at, otherwise a teacher with >limit bound slots
      -- in the [-7d, +30d] window starves the late-starting rows.
      -- Within the already-reconciled set we still prefer soon-starting
      -- slots (urgency for upcoming lessons).
      order by
        (case when s.status = 'cancelled' then 0 else 1 end),
        s.last_reconciled_at nulls first,
        s.start_at asc
      limit $1`,
    [limit],
  )
  return r.rows
    .filter((row) => STATUS_SET.has(String(row.status)))
    .map((row) => ({
      id: String(row.id),
      teacherAccountId: String(row.teacher_account_id),
      externalCalendarId: String(row.external_calendar_id),
      externalEventId: String(row.external_event_id),
      integrationEpoch:
        row.integration_epoch === null ? null : String(row.integration_epoch),
      status: String(row.status) as 'booked' | 'cancelled',
    }))
}

async function bumpReconciledAt(slotId: string): Promise<void> {
  const pool = getDbPool()
  await pool.query(
    `update lesson_slots
        set last_reconciled_at = now()
      where id = $1`,
    [slotId],
  )
}

// Codex round 4 P2 — migration 0042 added `cancel_repush_count`
// specifically for the F9‴ pathology: (delete succeeded → event
// resurrects → reconciler re-enqueues delete) loops. Plan §5 minor
// note #2 fires the operator alert at >= 3. Leaving this column at 0
// means repeated resurrection loops stay invisible to operators and
// any alerting built on the counter misses already-affected slots.
async function bumpReconciledAndCancelRepush(slotId: string): Promise<void> {
  const pool = getDbPool()
  await pool.query(
    `update lesson_slots
        set last_reconciled_at = now(),
            cancel_repush_count = cancel_repush_count + 1
      where id = $1`,
    [slotId],
  )
}

async function unbindSlot(
  slotId: string,
  opts: {
    markSyncFailed: boolean
    // Codex round 2 P2 + round 6 P1: guard the write on the FULL
    // originally-read snapshot. Status alone is not enough; event_id
    // alone is not enough either. Because `lib/calendar/google/push.ts`
    // mints `deterministicEventId(slotId)`, the SAME event_id legally
    // reappears on a DIFFERENT calendar after a teacher swaps their
    // write_calendar. Without locking the guard on (status, event_id,
    // calendar_id), a sweep processing the stale binding can wipe the
    // fresh binding to the new calendar.
    expectedStatus: 'booked' | 'cancelled'
    expectedExternalEventId: string
    expectedExternalCalendarId: string
  },
): Promise<{ updated: boolean }> {
  const pool = getDbPool()
  const r = await pool.query(
    `update lesson_slots
        set external_event_id = null,
            external_calendar_id = null,
            integration_epoch = null,
            last_reconciled_at = now(),
            external_sync_failed_at = case
              when $2::bool then coalesce(external_sync_failed_at, now())
              else external_sync_failed_at
            end
      where id = $1
        and status = $3
        and external_event_id = $4
        and external_calendar_id = $5`,
    [
      slotId,
      opts.markSyncFailed,
      opts.expectedStatus,
      opts.expectedExternalEventId,
      opts.expectedExternalCalendarId,
    ],
  )
  return { updated: (r.rowCount ?? 0) > 0 }
}

type LatestDeletePushJob = {
  status: string
  lastAttemptAt: string | null
} | null

async function readLatestDeletePushJob(
  slotId: string,
): Promise<LatestDeletePushJob> {
  const pool = getDbPool()
  const r = await pool.query(
    `select status, last_attempt_at
       from calendar_push_jobs
      where slot_id = $1
        and kind = 'delete'
      order by created_at desc
      limit 1`,
    [slotId],
  )
  if (r.rowCount === 0) return null
  const row = r.rows[0] as { status: unknown; last_attempt_at: unknown }
  return {
    status: String(row.status),
    lastAttemptAt:
      row.last_attempt_at === null
        ? null
        : new Date(String(row.last_attempt_at)).toISOString(),
  }
}

export type CancelGateDecision =
  | { enqueue: true }
  | { enqueue: false; reason: CancelGateSkipReason }

export function decideCancelReenqueue(opts: {
  latestJob: LatestDeletePushJob
  lastReconnectedAt: string | null
  nowMs?: number
}): CancelGateDecision {
  const nowMs = opts.nowMs ?? Date.now()
  const job = opts.latestJob
  if (!job) return { enqueue: true }
  if (job.status === 'pending' || job.status === 'in_progress') {
    return { enqueue: false, reason: 'inflight' }
  }
  if (job.status === 'cancelled_by_dependent') {
    return { enqueue: true }
  }
  if (job.status === 'succeeded') {
    if (!job.lastAttemptAt) return { enqueue: true }
    const ageMs = nowMs - new Date(job.lastAttemptAt).getTime()
    if (ageMs > REENQUEUE_AFTER_SUCCESS_MS) return { enqueue: true }
    return { enqueue: false, reason: 'recent_success' }
  }
  if (job.status === 'terminal_failure') {
    if (!job.lastAttemptAt) return { enqueue: true }
    const reconnectedAt = opts.lastReconnectedAt
      ? new Date(opts.lastReconnectedAt).getTime()
      : null
    const attemptAt = new Date(job.lastAttemptAt).getTime()
    if (reconnectedAt !== null && reconnectedAt > attemptAt) {
      return { enqueue: true }
    }
    return { enqueue: false, reason: 'terminal_no_env_change' }
  }
  // Unknown future status — be conservative, skip.
  return { enqueue: false, reason: 'inflight' }
}

async function reconcileSlot(
  candidate: CandidateSlot,
  fetchEventImpl: ReconcileFetchImpl,
  nowMs: number,
): Promise<ReconcileSlotOutcome> {
  const integration = await getGoogleIntegration(candidate.teacherAccountId)
  if (!integration) {
    return { kind: 'skipped_integration_missing' }
  }
  if (integration.syncState === 'disconnected') {
    return { kind: 'skipped_integration_disconnected' }
  }

  // BCS-OP-ROLLOUT plan §4.6 — wrap fetchEventById with withTokenRetry.
  // fetchEventById returns 401 as {ok:false, reason:'auth_expired'}.
  const wrapped = await withTokenRetry(
    candidate.teacherAccountId,
    async (token): Promise<CallResult<FetchEventOutcome>> => {
      const r = await fetchEventImpl({
        accessToken: token,
        externalCalendarId: candidate.externalCalendarId,
        eventId: candidate.externalEventId,
      })
      // Pass the full FetchEventOutcome through — the downstream
      // reconcile state machine branches on its specific reason variants
      // (not_found, server_error, etc). The wrap only intercepts the
      // auth_expired variant for retry.
      if (r.ok) return { ok: true, value: r }
      return {
        ok: false,
        auth401: r.reason === 'auth_expired',
        raw: r,
      }
    },
  )
  // wrappedOk path uses .value (a FetchEventOutcome with ok:true).
  // wrappedFail path: if .raw is a FetchEventOutcome variant we
  // preserved (auth_expired or other), surface it. If .raw is a
  // token-refresh FreshTokenResult permanent/transient, map to
  // skipped_token_refresh_failed.
  let outcome: FetchEventOutcome
  if (wrapped.ok) {
    outcome = wrapped.value
  } else if (
    wrapped.raw
    && typeof wrapped.raw === 'object'
    && 'reason' in (wrapped.raw as Record<string, unknown>)
    && typeof (wrapped.raw as { reason: unknown }).reason === 'string'
  ) {
    outcome = wrapped.raw as FetchEventOutcome
  } else {
    return {
      kind: 'skipped_token_refresh_failed',
      reason:
        (wrapped.raw as { reason?: string })?.reason
        ?? 'transient',
    }
  }

  // Transient-failure branches: do NOT bump reconciled_at. The next
  // sweep should retry these rows ahead of the fully-healthy ones.
  if (!outcome.ok) {
    if (outcome.reason === 'rate_limited') {
      return { kind: 'skipped_rate_limited' }
    }
    if (outcome.reason === 'server_error') {
      return { kind: 'skipped_server_error', status: outcome.status }
    }
    if (outcome.reason === 'auth_expired') {
      return { kind: 'skipped_auth_expired' }
    }
    if (outcome.reason === 'forbidden') {
      return { kind: 'skipped_forbidden' }
    }
    if (outcome.reason === 'network') {
      return { kind: 'skipped_network', message: outcome.message }
    }
    if (outcome.reason === 'shape') {
      return { kind: 'skipped_shape', message: outcome.message }
    }
    // outcome.reason === 'not_found'
    const markSyncFailed = candidate.status === 'booked'
    const r = await unbindSlot(candidate.id, {
      markSyncFailed,
      expectedStatus: candidate.status,
      expectedExternalEventId: candidate.externalEventId,
      expectedExternalCalendarId: candidate.externalCalendarId,
    })
    if (!r.updated) {
      return { kind: 'skipped_state_changed' }
    }
    return {
      kind: markSyncFailed
        ? 'unbound_after_sync_failure'
        : 'unbound_after_drift_resolved',
    }
  }

  const event = outcome.event

  // Google-side soft-cancellation tombstone. events.get returns the
  // row with status='cancelled' even if showDeleted defaulted off on
  // list queries. Treat as effective 404 for booked rows; drift
  // resolved for cancelled rows.
  if (event.status === 'cancelled') {
    const markSyncFailed = candidate.status === 'booked'
    const r = await unbindSlot(candidate.id, {
      markSyncFailed,
      expectedStatus: candidate.status,
      expectedExternalEventId: candidate.externalEventId,
      expectedExternalCalendarId: candidate.externalCalendarId,
    })
    if (!r.updated) {
      return { kind: 'skipped_state_changed' }
    }
    return {
      kind: markSyncFailed
        ? 'unbound_after_sync_failure'
        : 'unbound_after_drift_resolved',
    }
  }

  if (candidate.status === 'cancelled') {
    // Cancelled locally but Google still has it. Before re-enqueueing
    // a delete, verify ownership — Codex round 5 P1: if the binding
    // drifted to another slot's event or to a user-created event,
    // deleting it would destroy unrelated content. Same lc_slot_id
    // check the booked path uses, applied here for delete safety.
    const sharedC = event.extendedProperties?.shared ?? {}
    const lcSlotIdC =
      typeof sharedC.lc_slot_id === 'string' ? sharedC.lc_slot_id : null
    const lcEpochC =
      typeof sharedC.lc_epoch === 'string' ? sharedC.lc_epoch : null
    const slotMismatchC = lcSlotIdC === null || lcSlotIdC !== candidate.id
    const epochMismatchC =
      candidate.integrationEpoch !== null
      && (lcEpochC === null || lcEpochC !== candidate.integrationEpoch)
    if (slotMismatchC || epochMismatchC) {
      // Drifted binding. Unbind safely WITHOUT delete enqueue. No
      // sync_failed flag — this isn't a sync failure, this is a
      // corrupted binding being healed.
      const r = await unbindSlot(candidate.id, {
        markSyncFailed: false,
        expectedStatus: candidate.status,
        expectedExternalEventId: candidate.externalEventId,
      expectedExternalCalendarId: candidate.externalCalendarId,
      })
      if (!r.updated) return { kind: 'skipped_state_changed' }
      return { kind: 'unbound_after_drift_resolved_alien' }
    }

    // F9‴ gated re-enqueue (ownership confirmed above).
    const latestJob = await readLatestDeletePushJob(candidate.id)
    const decision = decideCancelReenqueue({
      latestJob,
      lastReconnectedAt: integration.lastReconnectedAt,
      nowMs,
    })
    if (!decision.enqueue) {
      await bumpReconciledAt(candidate.id)
      return { kind: 'cancel_gate_skipped', reason: decision.reason }
    }
    // Codex round 3 P2: write_calendar_id for the delete push must
    // come from the slot binding when integration.write_calendar_id is
    // null. The teacher may have cleared / rotated the current write
    // calendar AFTER this event was created — the event still lives
    // in `candidate.externalCalendarId` (that's what the binding
    // remembers). Without this fallback the sweep would mark the
    // row reconciled but skip the actual delete enqueue and the
    // stale Google event would remain forever.
    const writeCalendarId =
      integration.writeCalendarId ?? candidate.externalCalendarId
    const enq = await enqueuePushJob({
      slotId: candidate.id,
      teacherAccountId: candidate.teacherAccountId,
      kind: 'delete',
      payload: { write_calendar_id: writeCalendarId },
    })
    // Codex round 6 P3: enqueuePushJob dedups on the
    // (slot_id, kind) partial unique index when there is already a
    // pending row. Between readLatestDeletePushJob() above and this
    // INSERT, another worker can land a pending delete; the gate
    // check passed but the actual insert no-ops. Treat that as
    // "another worker beat us to it" (inflight) — do NOT bump
    // cancel_repush_count, do NOT report cancel_reenqueued, so the
    // pathology alert and sweep metrics stay honest.
    if (!enq.inserted) {
      await bumpReconciledAt(candidate.id)
      return { kind: 'cancel_gate_skipped', reason: 'inflight' }
    }
    // Bump the pathology counter alongside last_reconciled_at — this
    // is the ONLY codepath in the codebase that increments
    // cancel_repush_count, per the column's docstring in 0042.
    await bumpReconciledAndCancelRepush(candidate.id)
    return { kind: 'cancel_reenqueued' }
  }

  // candidate.status === 'booked'. Compare the full ownership stamp.
  //
  // Codex round 1 P1: lc_slot_id MUST be checked too. The push side
  // stamps both `lc_slot_id` and `lc_epoch` precisely so reconcile
  // can detect same-epoch misbindings (slot.external_event_id ever
  // pointing at another slot's event within the same integration
  // session). Comparing only lc_epoch would mark such drift as
  // `healthy` and the misbinding would survive every sweep.
  //
  // Codex round 2 P2: if the local row has an integration_epoch but
  // the fetched event has NO `lc_epoch` (malformed / partially-copied
  // event written outside the full LC contract), we previously fell
  // through to `healthy`. Treat that as orphan_self too — match
  // requires the stamp to be PRESENT when the local epoch is set.
  //
  // Final match rule for booked rows:
  //   lc_slot_id present AND == candidate.id, AND
  //   (candidate.integrationEpoch IS NULL OR
  //    (lc_epoch present AND == candidate.integrationEpoch))
  const shared = event.extendedProperties?.shared ?? {}
  const lcSlotId = typeof shared.lc_slot_id === 'string' ? shared.lc_slot_id : null
  const lcEpoch = typeof shared.lc_epoch === 'string' ? shared.lc_epoch : null
  const slotIdMismatch = lcSlotId === null || lcSlotId !== candidate.id
  const epochMismatch =
    candidate.integrationEpoch !== null
    && (lcEpoch === null || lcEpoch !== candidate.integrationEpoch)
  if (slotIdMismatch || epochMismatch) {
    await bumpReconciledAt(candidate.id)
    return { kind: 'orphan_self' }
  }

  await bumpReconciledAt(candidate.id)
  return { kind: 'healthy' }
}

export async function runReconcileSweep(opts?: {
  limit?: number
  nowMs?: number
  fetchEventImpl?: ReconcileFetchImpl
}): Promise<ReconcileSweepResult> {
  const limit = opts?.limit ?? DEFAULT_LIMIT
  const nowMs = opts?.nowMs ?? Date.now()
  const fetchImpl: ReconcileFetchImpl = opts?.fetchEventImpl ?? fetchEventById

  const candidates = await pickReconcileCandidates(limit)
  const outcomes: Record<string, number> = {}
  const details: ReconcileSweepResult['details'] = []

  for (const c of candidates) {
    let outcome: ReconcileSlotOutcome
    try {
      outcome = await reconcileSlot(c, fetchImpl, nowMs)
    } catch (e) {
      outcome = {
        kind: 'skipped_shape',
        message: e instanceof Error ? e.message : String(e),
      }
    }
    const key =
      outcome.kind === 'cancel_gate_skipped'
        ? `cancel_gate_skipped:${outcome.reason}`
        : outcome.kind
    outcomes[key] = (outcomes[key] ?? 0) + 1
    details.push({ slotId: c.id, outcome })
  }

  return { picked: candidates.length, outcomes, details }
}
