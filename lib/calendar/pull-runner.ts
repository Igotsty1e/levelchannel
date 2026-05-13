// BCS-D.2a — runs ONE pull cycle for ONE (teacher, externalCalendarId)
// pair. Plan §4.4 contract:
//
//   1. Fetch the integration row (decrypted access token).
//   2. Refuse if sync_state is 'disconnected' or no row exists.
//   3. Refuse if the access token is expired (token refresh lands in
//      D.2b — by design this lib assumes a fresh access token, so the
//      caller can decide how to fetch a new one).
//   4. Call pullBusyIntervalsForCalendar (lib/calendar/google/pull.ts).
//   5. Per interval, compute (is_own_event, is_orphan_self, is_writable)
//      per F8 epoch ownership rule:
//        - lc_origin === 'levelchannel' AND lc_slot_id matches a
//          known teacher slot AND lc_epoch === current epoch
//            → is_own_event = true
//        - lc_origin === 'levelchannel' AND lc_slot_id matches AND
//          lc_epoch !== current epoch
//            → is_orphan_self = true
//        - else → both false
//      is_writable_in_source is currently set from the slot's parent
//      calendar's accessRole. The caller passes the matching
//      `GoogleCalendarListEntry` so we can derive it without a second
//      Google round-trip.
//   6. In a single transaction:
//        DELETE rows for (teacher_account_id, external_calendar_id),
//        INSERT new rows from this pull,
//        UPDATE integrations.last_pulled_at = now(),
//        sync_state = 'active' (we just succeeded — flip from
//          'degraded' back to 'active').
//
// The DELETE+INSERT is the "full rewrite" per plan §4.4 (no syncToken
// in MVP). Cheap because the bounded window keeps the row count tight.

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
      intervalsAfter: number
      ownEvents: number
      orphanSelf: number
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

  const pull = await pullBusyIntervalsForCalendar({
    accessToken: integration.accessToken,
    externalCalendarId: opts.externalCalendarId,
    fetchImpl: opts.fetchImpl,
  })
  if (!pull.ok) {
    return { ok: false, error: pull.error }
  }

  // Resolve the set of slot ids belonging to this teacher so we can
  // recognise our own pushes when their `lc_slot_id` round-trips
  // back via Google.
  const pool = getDbPool()
  const slotIdsResult = await pool.query(
    `select id from lesson_slots where teacher_account_id = $1`,
    [opts.teacherAccountId],
  )
  const knownSlotIds = new Set(
    slotIdsResult.rows.map((r) => String(r.id)),
  )

  // Tx: full-rewrite. Drop existing busy intervals for this (teacher,
  // calendar) pair, insert the fresh page, update integration.
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

    await client.query(
      `delete from teacher_external_busy_intervals
        where teacher_account_id = $1 and external_calendar_id = $2`,
      [opts.teacherAccountId, opts.externalCalendarId],
    )

    let ownEvents = 0
    let orphanSelf = 0
    for (const interval of pull.intervals) {
      const flags = computeOwnership(interval, integration, knownSlotIds)
      if (flags.isOwnEvent) ownEvents++
      if (flags.isOrphanSelf) orphanSelf++
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

    await client.query(
      `update teacher_calendar_integrations
          set last_pulled_at = now(),
              sync_state = 'active',
              last_error = null,
              updated_at = now()
        where account_id = $1`,
      [opts.teacherAccountId],
    )

    await client.query('commit')

    return {
      ok: true,
      teacherAccountId: opts.teacherAccountId,
      externalCalendarId: opts.externalCalendarId,
      intervalsBefore,
      intervalsAfter: pull.intervals.length,
      ownEvents,
      orphanSelf,
    }
  } catch (e) {
    await client.query('rollback').catch(() => {})
    throw e
  } finally {
    client.release()
  }
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
