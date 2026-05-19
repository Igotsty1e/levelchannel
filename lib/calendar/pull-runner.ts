// BCS-D.2a — runs ONE pull cycle for ONE (teacher, externalCalendarId)
// pair. Plan §4.4 contract + BCS-DEF-7 Phase 2 (2026-05-19):
//
//   1. Fetch the integration row (decrypted access token).
//   2. Refuse if sync_state is 'disconnected' or no row exists.
//   3. Refuse if the access token is expired (token refresh lands in
//      D.2b — by design this lib assumes a fresh access token, so the
//      caller can decide how to fetch a new one).
//   4. Mode decision (BCS-DEF-7 §2.2): if integration.nextSyncToken is
//      non-null AND the teacher is "active" (at least one booked
//      future slot in the last 14d OR pulled within 24h), run delta
//      mode. Otherwise full-rewrite.
//   5. Call pullBusyIntervalsForCalendar (lib/calendar/google/pull.ts)
//      in the chosen mode.
//   6. Per interval, compute (is_own_event, is_orphan_self, is_writable)
//      per F8 epoch ownership rule (identical for both modes — see
//      `computeOwnership`).
//   7. In a single transaction:
//      Full-rewrite mode:
//        DELETE rows for (teacher_account_id, external_calendar_id),
//        INSERT new rows from this pull (own tombstones).
//      Delta mode:
//        For each event: DELETE if status='cancelled', else UPSERT.
//      Then:
//        UPDATE integrations.last_pulled_at = now(),
//          sync_state = 'active', next_sync_token = $captured_token
//          WHERE next_sync_token IS NOT DISTINCT FROM $started_with
//          AND epoch = $started_epoch.
//      The optimistic guard (§0a BLOCKER#3 closure) handles two race
//      modes: a concurrent winning worker (different token) and a
//      reconnect rotating epoch mid-flight (different epoch). On
//      rowcount=0 the TX rolls back and the job marks succeeded with
//      intervalsAfter=0 (redundant work).
//
// The DELETE+INSERT full-rewrite (when next_sync_token is NULL) seeds
// the token for the next cycle's delta. Cheap because the bounded
// window keeps the row count tight; subsequent cycles ride the delta
// track until 410 expiry or reconnect.

import {
  getGoogleIntegration,
  type TeacherCalendarIntegrationWithTokens,
} from '@/lib/calendar/integrations'
import {
  getCalendarEncryptionKey,
} from '@/lib/calendar/encryption'
import {
  pullBusyIntervalsForCalendar,
  type ParsedBusyInterval,
  type PullError,
} from '@/lib/calendar/google/pull'
import { withTokenRetry, type CallResult } from '@/lib/calendar/token-retry'
import { getDbPool } from '@/lib/db/pool'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SUMMARY_MAX_CHARS = 64

export type RunPullError =
  | { kind: 'integration_missing'; message: string }
  | { kind: 'integration_disconnected'; message: string }
  | { kind: 'access_token_missing'; message: string }
  | { kind: 'access_token_expired'; message: string }
  | { kind: 'encryption_key_missing'; message: string }
  | { kind: 'invalid_account'; message: string }
  | PullError

export type RunPullResult =
  | {
      ok: true
      teacherAccountId: string
      externalCalendarId: string
      intervalsBefore: number
      // For full-rewrite: count of intervals INSERTed.
      // For delta: count of intervals merged (UPSERTed + DELETEd).
      intervalsAfter: number
      ownEvents: number
      orphanSelf: number
      // BCS-DEF-7 Phase 2: pull mode actually taken. `delta` =
      // token-based incremental; `full` = bounded full-rewrite.
      mode: 'delta' | 'full'
      // True when delta returned a fresh nextSyncToken different
      // from what we sent. Useful for "is Google actually rotating
      // our tokens?" debugging. Always false in full-rewrite mode.
      deltaTokenRefreshed: boolean
      // Cancelled events DELETEd from the cache (delta only; 0 in
      // full-rewrite mode).
      cancelledEvents: number
    }
  | { ok: false; error: RunPullError }

export type RunPullOptions = {
  teacherAccountId: string
  externalCalendarId: string
  // Whether the configured calendar is owner/writer in Google.
  // Caller derived this from listCalendars. When omitted, defaults to
  // false (= we treat the source as read-only and disable the
  // "delete external event" UI gate, plan §4.7 action b).
  isWritableInSource?: boolean
  // For tests + simulation. Defaults to global fetch.
  fetchImpl?: typeof fetch
  // For tests — override the "now" clock used by the token expiry
  // check.
  nowMs?: number
}

export async function runPullForCalendar(
  opts: RunPullOptions,
): Promise<RunPullResult> {
  if (!UUID_PATTERN.test(opts.teacherAccountId)) {
    return {
      ok: false,
      error: { kind: 'invalid_account', message: 'teacherAccountId must be a UUID' },
    }
  }
  const encKey = getCalendarEncryptionKey()
  if (!encKey) {
    return {
      ok: false,
      error: {
        kind: 'encryption_key_missing',
        message:
          'CALENDAR_ENCRYPTION_KEY is not configured; cannot pull (would fail to decrypt access token).',
      },
    }
  }

  const integration = await getGoogleIntegration(opts.teacherAccountId)
  if (!integration) {
    return {
      ok: false,
      error: {
        kind: 'integration_missing',
        message: `no integration row for account ${opts.teacherAccountId}`,
      },
    }
  }
  if (integration.syncState === 'disconnected') {
    return {
      ok: false,
      error: {
        kind: 'integration_disconnected',
        message: 'integration is disconnected; reconnect first',
      },
    }
  }
  if (!integration.accessToken) {
    return {
      ok: false,
      error: {
        kind: 'access_token_missing',
        message: 'no access token stored (post-disconnect or pre-connect state)',
      },
    }
  }
  // Refuse expired tokens — refresh lives in D.2b. Caller should
  // refresh and retry.
  const nowMs = opts.nowMs ?? Date.now()
  if (
    integration.tokenExpiresAt
    && new Date(integration.tokenExpiresAt).getTime() <= nowMs
  ) {
    return {
      ok: false,
      error: {
        kind: 'access_token_expired',
        message: 'access token expired; refresh before pulling',
      },
    }
  }

  // BCS-DEF-7 Phase 2 §2.2 — mode decision. Capture (token, epoch)
  // into local state at the start of the cycle; the optimistic guard
  // on the integration UPDATE later fences against epoch rotation
  // (reconnect mid-flight) and a concurrent worker's token write.
  const startedToken = integration.nextSyncToken
  const startedEpoch = integration.epoch
  const pool = getDbPool()
  const teacherActive = await isActiveTeacher(
    pool,
    opts.teacherAccountId,
    integration.lastPulledAt,
    opts.nowMs ?? nowMs,
  )
  const mode: 'delta' | 'full' =
    startedToken !== null && teacherActive ? 'delta' : 'full'

  // BCS-OP-ROLLOUT plan §4.6 — wrap the Google call with withTokenRetry.
  // pullBusyIntervalsForCalendar returns 401 as a result variant
  // ({ok:false, error:{kind:'http', status:401}}); adapt to CallResult
  // so withTokenRetry can detect auth401 and force-refresh on first
  // 401, flip to disconnected on second.
  type PullValue = {
    intervals: ParsedBusyInterval[]
    cancelledEventIds: string[]
    nextSyncToken: string | null
  }
  const wrapped = await withTokenRetry(
    opts.teacherAccountId,
    async (token, _integration): Promise<CallResult<PullValue>> => {
      const r = await pullBusyIntervalsForCalendar({
        accessToken: token,
        externalCalendarId: opts.externalCalendarId,
        fetchImpl: opts.fetchImpl,
        syncToken: mode === 'delta' ? startedToken! : undefined,
      })
      if (r.ok) {
        return {
          ok: true,
          value: {
            intervals: r.intervals,
            cancelledEventIds: r.cancelledEventIds,
            nextSyncToken: r.nextSyncToken,
          },
        }
      }
      const auth401 =
        r.error.kind === 'http' && r.error.status === 401
      return { ok: false, auth401, raw: r.error }
    },
  )
  if (!wrapped.ok) {
    // Surface the original Google-client error shape when possible
    // (so the existing markFailure pattern in pull-worker still sees
    // {kind:'http', status:401} etc). When the failure came from
    // ensureFreshAccessToken instead, raw is a FreshTokenResult; map
    // it to a synthetic shape compatible with RunPullError.
    const raw = wrapped.raw
    if (
      raw
      && typeof raw === 'object'
      && 'kind' in raw
      && typeof (raw as { kind: unknown }).kind === 'string'
    ) {
      const err = raw as PullError
      // BCS-DEF-7 Phase 2 §2.3.1 — on sync_token_expired, null-out
      // the stored token so the next pull falls back to full-rewrite
      // automatically. Fence on (epoch, token) to avoid clobbering a
      // post-reconnect rotation or a successful concurrent capture.
      if (err.kind === 'sync_token_expired') {
        await pool.query(
          `update teacher_calendar_integrations
              set next_sync_token = null,
                  last_error = 'sync_token_expired',
                  updated_at = now()
            where account_id = $1
              and next_sync_token is not distinct from $2::text
              and epoch = $3::text`,
          [opts.teacherAccountId, startedToken, startedEpoch],
        )
      }
      return { ok: false, error: err }
    }
    return {
      ok: false,
      error: {
        kind: 'integration_disconnected',
        message: `token-retry failed: ${
          (raw as { reason?: string })?.reason ?? 'unknown'
        }`,
      },
    }
  }
  const pull = wrapped.value
  const tokenFromGoogle = pull.nextSyncToken

  // Resolve the set of slot ids belonging to this teacher so we can
  // recognise our own pushes when their `lc_slot_id` round-trips
  // back via Google.
  const slotIdsResult = await pool.query(
    `select id from lesson_slots where teacher_account_id = $1`,
    [opts.teacherAccountId],
  )
  const knownSlotIds = new Set(
    slotIdsResult.rows.map((r) => String(r.id)),
  )

  const client = await pool.connect()
  try {
    await client.query('begin')

    const before = await client.query(
      `select count(*)::int as n
         from teacher_external_busy_intervals
        where teacher_account_id = $1 and external_calendar_id = $2`,
      [opts.teacherAccountId, opts.externalCalendarId],
    )
    const intervalsBefore = Number(before.rows[0]?.n ?? 0)

    let ownEvents = 0
    let orphanSelf = 0
    let cancelledEvents = 0
    let intervalsAfter = 0

    if (mode === 'full') {
      // Full-rewrite: DELETE everything for (teacher, calendar) then
      // INSERT the fresh page. cancelledEventIds is empty here
      // because showDeleted=false in full-rewrite mode.
      await client.query(
        `delete from teacher_external_busy_intervals
          where teacher_account_id = $1 and external_calendar_id = $2`,
        [opts.teacherAccountId, opts.externalCalendarId],
      )

      for (const interval of pull.intervals) {
        const flags = computeOwnership(interval, integration, knownSlotIds)
        if (flags.isOwnEvent) ownEvents++
        if (flags.isOrphanSelf) orphanSelf++
        await upsertInterval(client, opts, interval, flags, encKey)
      }
      intervalsAfter = pull.intervals.length
    } else {
      // Delta merge: per-row DELETE for cancelled tombstones; UPSERT
      // for active rows. No full-table DELETE.
      for (const cancelledId of pull.cancelledEventIds) {
        const del = await client.query(
          `delete from teacher_external_busy_intervals
            where teacher_account_id = $1
              and external_calendar_id = $2
              and external_event_id = $3`,
          [opts.teacherAccountId, opts.externalCalendarId, cancelledId],
        )
        // No-op when the row never existed locally (webhook landed
        // first, or pre-existing tombstone). Cheap and harmless.
        cancelledEvents += del.rowCount ?? 0
      }
      for (const interval of pull.intervals) {
        const flags = computeOwnership(interval, integration, knownSlotIds)
        if (flags.isOwnEvent) ownEvents++
        if (flags.isOrphanSelf) orphanSelf++
        await upsertInterval(client, opts, interval, flags, encKey)
      }
      intervalsAfter = pull.intervals.length + cancelledEvents
    }

    // BCS-DEF-7 Phase 2 §2.3.5 — optimistic guard on the token
    // write. The IS NOT DISTINCT FROM handles NULL→token (first
    // capture from a full-rewrite cycle) correctly; the epoch
    // fence kills the reconnect-mid-flight race deterministically.
    // We only persist a new token when Google actually gave us one
    // (final page nextSyncToken non-null) — partial pagination
    // never lands the token here.
    //
    // When the guard misses (rowcount=0): another worker raced us
    // OR the epoch rotated under us. Roll back the TX so we don't
    // commit half-applied delta merges against a stale token.
    const guardResult = await client.query(
      `update teacher_calendar_integrations
          set last_pulled_at = now(),
              sync_state = 'active',
              last_error = null,
              next_sync_token = coalesce($4::text, next_sync_token),
              updated_at = now()
        where account_id = $1
          and next_sync_token is not distinct from $2::text
          and epoch = $3::text`,
      [opts.teacherAccountId, startedToken, startedEpoch, tokenFromGoogle],
    )
    const guardMatched = (guardResult.rowCount ?? 0) > 0

    if (!guardMatched) {
      // Race lost — another worker landed first, OR reconnect
      // rotated the epoch mid-flight. Roll back and signal a
      // no-op success so the job state stays clean.
      await client.query('rollback')
      return {
        ok: true,
        teacherAccountId: opts.teacherAccountId,
        externalCalendarId: opts.externalCalendarId,
        intervalsBefore,
        intervalsAfter: 0,
        ownEvents: 0,
        orphanSelf: 0,
        mode,
        deltaTokenRefreshed: false,
        cancelledEvents: 0,
      }
    }

    await client.query('commit')

    const deltaTokenRefreshed =
      mode === 'delta'
      && tokenFromGoogle !== null
      && tokenFromGoogle !== startedToken

    return {
      ok: true,
      teacherAccountId: opts.teacherAccountId,
      externalCalendarId: opts.externalCalendarId,
      intervalsBefore,
      intervalsAfter,
      ownEvents,
      orphanSelf,
      mode,
      deltaTokenRefreshed,
      cancelledEvents,
    }
  } catch (e) {
    await client.query('rollback').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}

// BCS-DEF-7 §2.2 active-teacher predicate. Constants are hardcoded
// (tuneable in a follow-up if real numbers drift, per plan §11 Q2).
// Returns true when:
//   (a) the teacher has at least one slot booked in the last 14d, OR
//   (b) the integration was pulled within the last 24h.
// (a) catches teachers with active learner demand — they're the
// population worth optimizing for. (b) catches freshly-connected
// quiet teachers so we don't pay one full-rewrite per cron tick
// during the 14d learner-discovery window.
async function isActiveTeacher(
  pool: ReturnType<typeof getDbPool>,
  teacherAccountId: string,
  lastPulledAt: string | null,
  nowMs: number,
): Promise<boolean> {
  if (lastPulledAt) {
    const lastPulledMs = new Date(lastPulledAt).getTime()
    if (Number.isFinite(lastPulledMs) && nowMs - lastPulledMs <= 24 * 60 * 60_000) {
      return true
    }
  }
  const r = await pool.query(
    `select 1
       from lesson_slots
      where teacher_account_id = $1
        and status = 'booked'
        and booked_at >= now() - interval '14 days'
      limit 1`,
    [teacherAccountId],
  )
  return r.rows.length > 0
}

async function upsertInterval(
  client: import('pg').PoolClient,
  opts: RunPullOptions,
  interval: ParsedBusyInterval,
  flags: { isOwnEvent: boolean; isOrphanSelf: boolean },
  encKey: string,
): Promise<void> {
  await client.query(
    `insert into teacher_external_busy_intervals (
        teacher_account_id, external_calendar_id, external_event_id,
        start_at, end_at, summary_encrypted, is_all_day,
        is_writable_in_source, is_own_event, is_orphan_self,
        etag, fetched_at
      ) values (
        $1, $2, $3, $4::timestamptz, $5::timestamptz,
        case when $6::text is null then null else pgp_sym_encrypt($6::text, $11::text) end,
        $7, $8, $9, $10, $12, now()
      )
      on conflict (teacher_account_id, external_calendar_id, external_event_id)
        do update set
          start_at = excluded.start_at,
          end_at = excluded.end_at,
          summary_encrypted = excluded.summary_encrypted,
          is_all_day = excluded.is_all_day,
          is_writable_in_source = excluded.is_writable_in_source,
          is_own_event = excluded.is_own_event,
          is_orphan_self = excluded.is_orphan_self,
          etag = excluded.etag,
          fetched_at = excluded.fetched_at`,
    [
      opts.teacherAccountId,
      opts.externalCalendarId,
      interval.externalEventId,
      interval.startAt,
      interval.endAt,
      truncateForStorage(interval.summary),
      interval.isAllDay,
      opts.isWritableInSource ?? false,
      flags.isOwnEvent,
      flags.isOrphanSelf,
      encKey,
      interval.etag,
    ],
  )
}

function truncateForStorage(s: string | null): string | null {
  if (!s) return null
  const trimmed = s.trim()
  if (trimmed.length === 0) return null
  return trimmed.length > SUMMARY_MAX_CHARS
    ? trimmed.slice(0, SUMMARY_MAX_CHARS)
    : trimmed
}

function computeOwnership(
  interval: ParsedBusyInterval,
  integration: TeacherCalendarIntegrationWithTokens,
  knownSlotIds: Set<string>,
): { isOwnEvent: boolean; isOrphanSelf: boolean } {
  // Plan §3.3 ownership stamp rule: ALL three fields must be present.
  // A coincidental match on lc_origin alone (e.g. an ICS import) must
  // NOT be treated as our own push.
  if (
    interval.lcOrigin !== 'levelchannel'
    || !interval.lcSlotId
    || !interval.lcEpoch
  ) {
    return { isOwnEvent: false, isOrphanSelf: false }
  }
  // Slot id must belong to this teacher (defends against an attacker-
  // crafted event with a leaked-but-foreign slot id).
  if (!knownSlotIds.has(interval.lcSlotId)) {
    return { isOwnEvent: false, isOrphanSelf: false }
  }
  if (interval.lcEpoch === integration.epoch) {
    return { isOwnEvent: true, isOrphanSelf: false }
  }
  return { isOwnEvent: false, isOrphanSelf: true }
}
