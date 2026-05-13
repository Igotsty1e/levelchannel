// BCS-D.complete — pull worker driver.
//
// Drains `calendar_pull_jobs` rows (FOR UPDATE SKIP LOCKED) and runs
// `runPullForCalendar` per job. Each job claims its row, runs the
// pull, and updates the job state to 'succeeded' / 'terminal_failure'
// or schedules a retry via `next_run_at + backoff`.
//
// Job lifecycle:
//   pending → in_progress (this worker claims with SKIP LOCKED)
//   in_progress → succeeded (happy)
//   in_progress → pending + next_run_at = now() + backoff (transient)
//   in_progress → terminal_failure (permanent, after MAX_ATTEMPTS)
//
// Token refresh is done up-front via ensureFreshAccessToken. If
// refresh returns `permanent` (refresh_token revoked) the integration
// is already disconnected by the helper, and we terminal-fail the
// job. `transient` → schedule retry.

import { ensureFreshAccessToken } from '@/lib/calendar/google/token-refresh'
import { runPullForCalendar } from '@/lib/calendar/pull-runner'
import { getDbPool } from '@/lib/db/pool'

const MAX_ATTEMPTS = 5
const BACKOFF_SCHEDULE_MS = [
  60_000, // 1 min
  2 * 60_000, // 2 min
  5 * 60_000, // 5 min
  15 * 60_000, // 15 min
  30 * 60_000, // 30 min
]

export type PullJobOutcome =
  | { kind: 'succeeded'; jobId: string; teacherAccountId: string }
  | {
      kind: 'retried'
      jobId: string
      teacherAccountId: string
      reason: string
      nextRunAt: string
    }
  | {
      kind: 'terminal_failure'
      jobId: string
      teacherAccountId: string
      reason: string
    }
  | { kind: 'skipped'; jobId: string; reason: string }

export async function drainPullJobs(opts: {
  maxJobs?: number
  fetchImpl?: typeof fetch
  nowMs?: number
}): Promise<{ outcomes: PullJobOutcome[] }> {
  const maxJobs = opts.maxJobs ?? 10
  const pool = getDbPool()
  const outcomes: PullJobOutcome[] = []

  for (let i = 0; i < maxJobs; i++) {
    const claim = await claimNextJob(pool)
    if (!claim) break // queue empty
    const outcome = await processOneJob({
      jobId: claim.id,
      teacherAccountId: claim.teacherAccountId,
      externalCalendarId: claim.externalCalendarId,
      attempts: claim.attempts,
      fetchImpl: opts.fetchImpl,
      nowMs: opts.nowMs,
    })
    outcomes.push(outcome)
  }
  return { outcomes }
}

async function claimNextJob(pool: ReturnType<typeof getDbPool>): Promise<{
  id: string
  teacherAccountId: string
  externalCalendarId: string
  attempts: number
} | null> {
  // FOR UPDATE SKIP LOCKED: at most one worker claims any given row.
  // Multiple workers can drain concurrently without contending.
  const result = await pool.query(
    `with claimed as (
       select id
         from calendar_pull_jobs
        where status = 'pending'
          and next_run_at <= now()
        order by priority desc, next_run_at asc
        limit 1
        for update skip locked
     )
     update calendar_pull_jobs j
        set status = 'in_progress', attempts = j.attempts + 1, last_attempt_at = now()
       from claimed
      where j.id = claimed.id
      returning j.id, j.teacher_account_id, j.external_calendar_id, j.attempts`,
  )
  if (result.rows.length === 0) return null
  const r = result.rows[0]
  return {
    id: String(r.id),
    teacherAccountId: String(r.teacher_account_id),
    externalCalendarId: String(r.external_calendar_id),
    attempts: Number(r.attempts),
  }
}

async function processOneJob(args: {
  jobId: string
  teacherAccountId: string
  externalCalendarId: string
  attempts: number
  fetchImpl?: typeof fetch
  nowMs?: number
}): Promise<PullJobOutcome> {
  const pool = getDbPool()

  // 1. Get fresh access token.
  const fresh = await ensureFreshAccessToken({
    accountId: args.teacherAccountId,
    nowMs: args.nowMs,
    fetchImpl: args.fetchImpl,
  })
  if (!fresh.ok) {
    return await markFailure(
      pool,
      args,
      `token: ${fresh.reason}${fresh.detail ? ` (${fresh.detail.slice(0, 80)})` : ''}`,
      isTransientReason(fresh.reason),
    )
  }

  // 2. Run the pull.
  const pull = await runPullForCalendar({
    teacherAccountId: args.teacherAccountId,
    externalCalendarId: args.externalCalendarId,
    fetchImpl: args.fetchImpl,
    nowMs: args.nowMs,
  })
  if (!pull.ok) {
    return await markFailure(
      pool,
      args,
      `pull: ${pull.error.kind}${'status' in pull.error ? ` ${pull.error.status}` : ''}`,
      isTransientPullError(pull.error.kind),
    )
  }

  // 3. Success.
  await pool.query(
    `update calendar_pull_jobs
        set status = 'succeeded', last_error = null
      where id = $1`,
    [args.jobId],
  )
  return {
    kind: 'succeeded',
    jobId: args.jobId,
    teacherAccountId: args.teacherAccountId,
  }
}

async function markFailure(
  pool: ReturnType<typeof getDbPool>,
  args: { jobId: string; teacherAccountId: string; attempts: number },
  reason: string,
  transient: boolean,
): Promise<PullJobOutcome> {
  if (!transient || args.attempts >= MAX_ATTEMPTS) {
    await pool.query(
      `update calendar_pull_jobs
          set status = 'terminal_failure', last_error = $2
        where id = $1`,
      [args.jobId, reason],
    )
    return {
      kind: 'terminal_failure',
      jobId: args.jobId,
      teacherAccountId: args.teacherAccountId,
      reason,
    }
  }
  // Transient + retries remain → reschedule with backoff.
  const idx = Math.min(args.attempts - 1, BACKOFF_SCHEDULE_MS.length - 1)
  const backoffMs = BACKOFF_SCHEDULE_MS[idx]
  const nextRunAt = new Date(Date.now() + backoffMs).toISOString()
  await pool.query(
    `update calendar_pull_jobs
        set status = 'pending', next_run_at = $3::timestamptz, last_error = $2
      where id = $1`,
    [args.jobId, reason, nextRunAt],
  )
  return {
    kind: 'retried',
    jobId: args.jobId,
    teacherAccountId: args.teacherAccountId,
    reason,
    nextRunAt,
  }
}

function isTransientReason(reason: string): boolean {
  return reason === 'transient' || reason === 'config_missing'
}

function isTransientPullError(kind: string): boolean {
  // network + shape are transient. HTTP 4xx (except 5xx) is usually
  // permanent — leave it terminal so we don't burn quota retrying.
  return kind === 'network' || kind === 'shape'
}

// Enqueue helper used by the OAuth-callback success path + the
// webhook handler. ON CONFLICT do nothing keeps the pending-uniqueness
// invariant (plan §3.5).
export async function enqueuePullJob(opts: {
  teacherAccountId: string
  externalCalendarId: string
  priority?: number
  nowMs?: number
}): Promise<{ inserted: boolean }> {
  const pool = getDbPool()
  const r = await pool.query(
    `insert into calendar_pull_jobs
        (teacher_account_id, external_calendar_id, priority, status, next_run_at)
     values ($1, $2, $3, 'pending', now())
     on conflict (teacher_account_id, external_calendar_id) where status='pending'
       do nothing
     returning id`,
    [opts.teacherAccountId, opts.externalCalendarId, opts.priority ?? 0],
  )
  return { inserted: r.rows.length > 0 }
}
