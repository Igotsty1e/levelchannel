// BCS-E.worker — drains `calendar_push_jobs`.
//
// Plan §4.5 + §8 #1 lock order:
//   TX1 per job:
//     - layer 4 lock: `select … from calendar_push_jobs … for update
//       skip locked`
//     - call ensureFreshAccessToken (no DB writes inside ensureFresh
//       outside the integration row's separate path)
//     - call insertEventIdempotent / patchEvent / deleteEvent
//     - layer 3 update: `update lesson_slots set external_event_id =
//       …, external_calendar_id = …, integration_epoch = …` on
//       success
//     - layer 4 update: mark job state
//   TX2 (separate, only on auth-revoked error):
//     - layer 1 update: flip integration sync_state = 'disconnected'
//
// Retry classification matches plan §4.7 + Codex pull-worker review:
//   - http 5xx + 429 + 403-quota body → transient (backoff)
//   - http 4xx other (including 403 non-quota, 400 bad request) →
//     permanent (terminal_failure)
//   - http 401 → "refresh failed" already happened at ensureFresh
//     layer; the job sees `permanent` from token-refresh
//   - http 404 / 410 on delete/patch → terminal-success (already
//     gone)
//   - network/shape → transient
//
// The `slot_lifecycle_intents` worker is the separate intent drainer:
//   - For `kind='post_cancel_push'`: enqueue a delete push job for
//     the slot. Cancel was split into two TX precisely to avoid the
//     lock-order inversion the Codex paranoia loop closed (plan §4.6
//     F6′ + F6″ + F6‴).

import { ensureFreshAccessToken } from '@/lib/calendar/google/token-refresh'
import {
  deleteEvent,
  insertEventIdempotent,
  patchEvent,
  type PushError,
} from '@/lib/calendar/google/push'
import { getDbPool } from '@/lib/db/pool'

const MAX_ATTEMPTS = 5
const BACKOFF_SCHEDULE_MS = [
  60_000,
  2 * 60_000,
  5 * 60_000,
  15 * 60_000,
  30 * 60_000,
]

export type PushJobOutcome =
  | { kind: 'succeeded'; jobId: string; slotId: string }
  | { kind: 'cancelled_by_dependent'; jobId: string; slotId: string }
  | {
      kind: 'retried'
      jobId: string
      slotId: string
      reason: string
      nextRunAt: string
    }
  | {
      kind: 'terminal_failure'
      jobId: string
      slotId: string
      reason: string
    }

type ClaimedJob = {
  id: string
  slotId: string
  teacherAccountId: string
  kind: 'create' | 'update' | 'delete'
  payload: Record<string, unknown>
  attempts: number
}

async function claimNextJob(): Promise<ClaimedJob | null> {
  const pool = getDbPool()
  const result = await pool.query(
    `with claimed as (
       select id from calendar_push_jobs
        where status = 'pending'
          and next_run_at <= now()
        order by created_at asc
        limit 1
        for update skip locked
     )
     update calendar_push_jobs j
        set status = 'in_progress', attempts = j.attempts + 1, last_attempt_at = now()
       from claimed
      where j.id = claimed.id
      returning j.id, j.slot_id, j.teacher_account_id, j.kind, j.payload, j.attempts`,
  )
  if (result.rows.length === 0) return null
  const r = result.rows[0]
  return {
    id: String(r.id),
    slotId: String(r.slot_id),
    teacherAccountId: String(r.teacher_account_id),
    kind: String(r.kind) as ClaimedJob['kind'],
    payload:
      typeof r.payload === 'object' && r.payload !== null
        ? (r.payload as Record<string, unknown>)
        : {},
    attempts: Number(r.attempts),
  }
}

async function readSlot(slotId: string): Promise<
  | {
      id: string
      teacherAccountId: string
      startAt: string
      endAt: string
      status: string
      externalEventId: string | null
      externalCalendarId: string | null
    }
  | null
> {
  const pool = getDbPool()
  const r = await pool.query(
    `select id, teacher_account_id, start_at,
            start_at + (duration_minutes || ' minutes')::interval as end_at,
            status, external_event_id, external_calendar_id
       from lesson_slots where id = $1`,
    [slotId],
  )
  if (r.rows.length === 0) return null
  return {
    id: String(r.rows[0].id),
    teacherAccountId: String(r.rows[0].teacher_account_id),
    startAt: new Date(String(r.rows[0].start_at)).toISOString(),
    endAt: new Date(String(r.rows[0].end_at)).toISOString(),
    status: String(r.rows[0].status),
    externalEventId: r.rows[0].external_event_id
      ? String(r.rows[0].external_event_id)
      : null,
    externalCalendarId: r.rows[0].external_calendar_id
      ? String(r.rows[0].external_calendar_id)
      : null,
  }
}

function isTransientPushError(error: PushError): boolean {
  if (error.kind === 'http') {
    if (error.status >= 500 || error.status === 429) return true
    if (error.status === 403 && isQuotaBody(error.body)) return true
    return false
  }
  if (error.kind === 'ownership_mismatch') return false
  return error.kind === 'network' || error.kind === 'shape'
}

function isQuotaBody(body: string): boolean {
  if (!body) return false
  const lower = body.toLowerCase()
  return (
    lower.includes('ratelimitexceeded')
    || lower.includes('userratelimitexceeded')
    || lower.includes('quotaexceeded')
  )
}

function describeError(error: PushError): string {
  if (error.kind === 'http') return `http ${error.status}: ${error.body.slice(0, 80)}`
  if (error.kind === 'ownership_mismatch')
    return `ownership_mismatch: ${error.foreignSlotId ?? 'unknown'}`
  return `${error.kind}: ${error.message}`
}

async function markFailure(
  job: ClaimedJob,
  reason: string,
  transient: boolean,
): Promise<PushJobOutcome> {
  const pool = getDbPool()
  if (!transient || job.attempts >= MAX_ATTEMPTS) {
    await pool.query(
      `update calendar_push_jobs set status = 'terminal_failure', last_error = $2 where id = $1`,
      [job.id, reason],
    )
    return {
      kind: 'terminal_failure',
      jobId: job.id,
      slotId: job.slotId,
      reason,
    }
  }
  const idx = Math.min(job.attempts - 1, BACKOFF_SCHEDULE_MS.length - 1)
  const next = new Date(Date.now() + BACKOFF_SCHEDULE_MS[idx]).toISOString()
  await pool.query(
    `update calendar_push_jobs set status = 'pending', next_run_at = $3::timestamptz, last_error = $2 where id = $1`,
    [job.id, reason, next],
  )
  return {
    kind: 'retried',
    jobId: job.id,
    slotId: job.slotId,
    reason,
    nextRunAt: next,
  }
}

async function markSucceeded(jobId: string, slotId: string): Promise<PushJobOutcome> {
  const pool = getDbPool()
  await pool.query(
    `update calendar_push_jobs set status = 'succeeded', last_error = null where id = $1`,
    [jobId],
  )
  return { kind: 'succeeded', jobId, slotId }
}

async function processCreate(job: ClaimedJob): Promise<PushJobOutcome> {
  const pool = getDbPool()
  const slot = await readSlot(job.slotId)
  if (!slot) {
    return markFailure(job, 'slot_missing', false)
  }
  // Codex F6 contract: cancelled slot ⇒ don't create; expect the
  // cancel intent worker to enqueue a delete shortly. Mark this
  // job cancelled_by_dependent + return.
  if (slot.status === 'cancelled') {
    await pool.query(
      `update calendar_push_jobs set status = 'cancelled_by_dependent' where id = $1`,
      [job.id],
    )
    return { kind: 'cancelled_by_dependent', jobId: job.id, slotId: job.slotId }
  }

  const fresh = await ensureFreshAccessToken({
    accountId: job.teacherAccountId,
  })
  if (!fresh.ok) {
    return markFailure(job, `token: ${fresh.reason}`, fresh.reason === 'transient')
  }

  const writeCalendar = String(job.payload.write_calendar_id ?? '')
  if (!writeCalendar) {
    return markFailure(job, 'payload_missing_write_calendar_id', false)
  }

  const inserted = await insertEventIdempotent({
    accessToken: fresh.accessToken,
    externalCalendarId: writeCalendar,
    slotId: slot.id,
    input: {
      startAt: slot.startAt,
      endAt: slot.endAt,
      summary:
        typeof job.payload.summary === 'string'
          ? job.payload.summary
          : 'LC: урок',
      ownership: {
        lcOrigin: 'levelchannel',
        lcSlotId: slot.id,
        lcEpoch: String(job.payload.lc_epoch ?? fresh.integration.epoch),
      },
    },
  })
  if (!inserted.ok) {
    return markFailure(
      job,
      describeError(inserted.error),
      isTransientPushError(inserted.error),
    )
  }
  // Codex E.worker review #1: post-API DB writes — slot binding +
  // job mark-succeeded — must land atomically. The initial claim TX
  // already committed (status='in_progress' is just a claim marker,
  // not a held lock), so two autocommit queries here would leave
  // either (a) slot bound but job still in_progress on crash, or
  // (b) job succeeded but slot unbound. Plan §8 #1: layer 4 +
  // layer 3 inside one TX.
  const client = await pool.connect()
  try {
    await client.query('begin')
    await client.query(
      `update lesson_slots
          set external_event_id = $2,
              external_calendar_id = $3,
              external_event_etag = $4,
              integration_epoch = $5,
              updated_at = now()
        where id = $1`,
      [
        slot.id,
        inserted.event.id,
        writeCalendar,
        inserted.event.etag,
        String(job.payload.lc_epoch ?? fresh.integration.epoch),
      ],
    )
    await client.query(
      `update calendar_push_jobs set status = 'succeeded', last_error = null where id = $1`,
      [job.id],
    )
    await client.query('commit')
  } catch (e) {
    await client.query('rollback').catch(() => {})
    throw e
  } finally {
    client.release()
  }
  return { kind: 'succeeded', jobId: job.id, slotId: slot.id }
}

async function processUpdate(job: ClaimedJob): Promise<PushJobOutcome> {
  const slot = await readSlot(job.slotId)
  if (!slot) return markFailure(job, 'slot_missing', false)
  if (!slot.externalEventId || !slot.externalCalendarId) {
    // No binding to patch — treat as needing recreate: enqueue a
    // create job intent? For now, terminal_failure — the operator
    // can rebind via the F.4 "delete external event" path or
    // reconcile sweep.
    return markFailure(job, 'no_external_event_id_bound', false)
  }
  if (slot.status === 'cancelled') {
    const pool = getDbPool()
    await pool.query(
      `update calendar_push_jobs set status = 'cancelled_by_dependent' where id = $1`,
      [job.id],
    )
    return { kind: 'cancelled_by_dependent', jobId: job.id, slotId: job.slotId }
  }

  const fresh = await ensureFreshAccessToken({
    accountId: job.teacherAccountId,
  })
  if (!fresh.ok) {
    return markFailure(job, `token: ${fresh.reason}`, fresh.reason === 'transient')
  }

  const patched = await patchEvent({
    accessToken: fresh.accessToken,
    externalCalendarId: slot.externalCalendarId,
    eventId: slot.externalEventId,
    input: {
      startAt: slot.startAt,
      endAt: slot.endAt,
      summary:
        typeof job.payload.summary === 'string' ? job.payload.summary : undefined,
    },
  })
  if (!patched.ok) {
    return markFailure(job, describeError(patched.error), isTransientPushError(patched.error))
  }
  return markSucceeded(job.id, slot.id)
}

async function processDelete(job: ClaimedJob): Promise<PushJobOutcome> {
  const slot = await readSlot(job.slotId)
  if (!slot) {
    // Slot row gone — nothing to delete; treat as success (the
    // event may still exist in Google but reconcile sweep handles).
    return markSucceeded(job.id, job.slotId)
  }
  const fresh = await ensureFreshAccessToken({
    accountId: job.teacherAccountId,
  })
  if (!fresh.ok) {
    return markFailure(job, `token: ${fresh.reason}`, fresh.reason === 'transient')
  }
  // Plan §4.6 F6: delete uses COALESCE(external_event_id, deterministic_id).
  // We pass in slot.externalEventId if set, otherwise compute from slotId.
  // The deterministic event id is recomputed by importing
  // `deterministicEventId` from push.ts; we keep it local for symmetry.
  const { deterministicEventId } = await import('@/lib/calendar/google/push')
  const eventIdToDelete = slot.externalEventId ?? deterministicEventId(slot.id)
  const writeCalendar =
    slot.externalCalendarId
    ?? (typeof job.payload.write_calendar_id === 'string'
      ? job.payload.write_calendar_id
      : null)
  if (!writeCalendar) {
    return markFailure(job, 'payload_missing_write_calendar_id', false)
  }
  const deleted = await deleteEvent({
    accessToken: fresh.accessToken,
    externalCalendarId: writeCalendar,
    eventId: eventIdToDelete,
  })
  if (!deleted.ok) {
    return markFailure(job, describeError(deleted.error), isTransientPushError(deleted.error))
  }
  // Codex E.worker review #1 (symmetric with processCreate): clear
  // binding + mark job succeeded in one TX. Without the wrapper,
  // crash between the two autocommit UPDATEs would leave the binding
  // cleared but the delete job still in_progress (drain restart
  // would re-claim and re-call Google → 404 on the second pass; harmless
  // but noisy) or vice versa.
  const pool = getDbPool()
  const client = await pool.connect()
  try {
    await client.query('begin')
    await client.query(
      `update lesson_slots
          set external_event_id = null,
              external_calendar_id = null,
              external_event_etag = null,
              updated_at = now()
        where id = $1
          and external_event_id = $2`,
      [slot.id, slot.externalEventId],
    )
    await client.query(
      `update calendar_push_jobs set status = 'succeeded', last_error = null where id = $1`,
      [job.id],
    )
    await client.query('commit')
  } catch (e) {
    await client.query('rollback').catch(() => {})
    throw e
  } finally {
    client.release()
  }
  return { kind: 'succeeded', jobId: job.id, slotId: slot.id }
}

export async function drainPushJobs(opts: {
  maxJobs?: number
}): Promise<{ outcomes: PushJobOutcome[] }> {
  const maxJobs = opts.maxJobs ?? 10
  const outcomes: PushJobOutcome[] = []
  for (let i = 0; i < maxJobs; i++) {
    const job = await claimNextJob()
    if (!job) break
    let outcome: PushJobOutcome
    if (job.kind === 'create') outcome = await processCreate(job)
    else if (job.kind === 'update') outcome = await processUpdate(job)
    else outcome = await processDelete(job)
    outcomes.push(outcome)
  }
  return { outcomes }
}

// Wire-up helper used by /api/slots/[id]/book + admin book-as-operator.
// Fire-and-forget enqueue of a create push job IFF the teacher has an
// active or degraded integration with a configured write calendar.
// Disconnected → no-op (book without push is the legacy behaviour).
// Plan §4.2 ideal is "enqueue atomic with slot.booked"; we ship a
// near-atomic non-blocking variant. F9″ reconcile sweep catches the
// rare gap if this fails between slot UPDATE and enqueue.
export async function enqueueCreatePushIfIntegrationActive(opts: {
  slotId: string
  teacherAccountId: string
}): Promise<{ enqueued: boolean }> {
  const pool = getDbPool()
  const r = await pool.query(
    `select sync_state, write_calendar_id, epoch
       from teacher_calendar_integrations
      where account_id = $1
        and sync_state in ('active', 'degraded')`,
    [opts.teacherAccountId],
  )
  if (r.rows.length === 0) return { enqueued: false }
  const writeCalendar = r.rows[0].write_calendar_id
    ? String(r.rows[0].write_calendar_id)
    : null
  if (!writeCalendar) return { enqueued: false }
  const enq = await enqueuePushJob({
    slotId: opts.slotId,
    teacherAccountId: opts.teacherAccountId,
    kind: 'create',
    payload: {
      write_calendar_id: writeCalendar,
      lc_epoch: String(r.rows[0].epoch ?? ''),
    },
  })
  return { enqueued: enq.inserted }
}

// Helper: enqueue a push job. Plan §3.4 partial-unique (slot_id, kind)
// WHERE status='pending'. ON CONFLICT DO NOTHING — push side doesn't
// have the priority-upgrade semantics of pull (pull-worker's
// enqueuePullJob does DO UPDATE).
export async function enqueuePushJob(opts: {
  slotId: string
  teacherAccountId: string
  kind: 'create' | 'update' | 'delete'
  payload: Record<string, unknown>
}): Promise<{ inserted: boolean }> {
  const pool = getDbPool()
  const r = await pool.query(
    `insert into calendar_push_jobs
       (slot_id, teacher_account_id, kind, payload, status, next_run_at)
     values ($1, $2, $3, $4::jsonb, 'pending', now())
     on conflict (slot_id, kind) where status = 'pending'
       do nothing
     returning id`,
    [opts.slotId, opts.teacherAccountId, opts.kind, JSON.stringify(opts.payload)],
  )
  return { inserted: r.rows.length > 0 }
}
