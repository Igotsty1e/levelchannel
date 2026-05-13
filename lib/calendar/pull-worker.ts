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

import type { PullError } from '@/lib/calendar/google/pull'
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
      isTransientPullError(pull.error),
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

function isTransientPullError(error: PullError): boolean {
  // Plan §4.7 retry contract + Google Calendar errors guide
  // (developers.google.com/workspace/calendar/api/guides/errors):
  //
  //   - 5xx: Google outage → transient.
  //   - 429: rateLimitExceeded → transient (exponential backoff).
  //   - 403 with `rateLimitExceeded` / `userRateLimitExceeded` /
  //     `quotaExceeded` in the response body: Google can return
  //     quota throttling as 403. Treat as transient when the body
  //     hints at rate-limit; permanent otherwise (true authz fail).
  //   - 4xx other than 429 / quota-403: permanent.
  //   - network + shape: transient.
  //
  // Codex D.complete v2 review closed: 403-as-quota was previously
  // dead-lettered.
  if (error.kind === 'http') {
    if (error.status >= 500 || error.status === 429) return true
    if (error.status === 403 && isQuotaBody(error.body)) return true
    return false
  }
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

// Enqueue helper used by the OAuth-callback success path + the
// webhook handler. Plan §3.5: at most one pending row per
// (teacher, calendar).
//
// Codex D.complete review: DO NOTHING was too weak. If a row was
// already pending with backoff-pushed next_run_at, a fresh webhook
// (priority=2 realtime) was silently dropped — realtime upgrades
// blocked for up to 30 min. Fix: DO UPDATE — pull next_run_at
// forward via LEAST, raise priority via GREATEST. The pending-
// uniqueness invariant is preserved (still one row at a time per
// pair), but a higher-priority arrival always wins.
export async function enqueuePullJob(opts: {
  teacherAccountId: string
  externalCalendarId: string
  priority?: number
  nowMs?: number
}): Promise<{ upserted: boolean }> {
  const pool = getDbPool()
  const r = await pool.query(
    `insert into calendar_pull_jobs
        (teacher_account_id, external_calendar_id, priority, status, next_run_at)
     values ($1, $2, $3, 'pending', now())
     on conflict (teacher_account_id, external_calendar_id) where status='pending'
       do update set
         next_run_at = least(calendar_pull_jobs.next_run_at, excluded.next_run_at),
         priority    = greatest(calendar_pull_jobs.priority, excluded.priority)
     returning id`,
    [opts.teacherAccountId, opts.externalCalendarId, opts.priority ?? 0],
  )
  return { upserted: r.rows.length > 0 }
}
