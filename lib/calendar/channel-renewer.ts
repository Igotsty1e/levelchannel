// BCS-D.4 — channel-renewer.
//
// Drives initial channel setup + periodic renewal:
//
//   * `setupChannelForIntegration(accountId, externalCalendarId)` —
//     called by the OAuth callback after a successful connect AND by
//     the cron sweep for an integration without a channel. Mints a
//     fresh channel id + token, calls channels.watch, stores the
//     (channel_id, resource_id, expires_at, token) triple on the
//     integration row.
//
//   * `renewExpiringChannels()` — cron entry. For each integration
//     where channel_expires_at < now() + 24h, stop the old channel,
//     mint a new one, persist. Bounded batch, idempotent.
//
// Channel rotation contract (plan §4.9 + Google docs):
//   - Google's max channel lifetime is 7 days for calendar events.
//   - Renew at least 24h before expiry so notifications never drop.
//   - Stop the old channel after the new one is in place — Google
//     ignores receivers that don't match the live (channel_id,
//     resource_id) pair, so transient overlap is safe.

import { randomBytes, randomUUID } from 'node:crypto'

import { ensureFreshAccessToken } from '@/lib/calendar/google/token-refresh'
import {
  stopChannel,
  watchChannel,
  type WatchChannelError,
} from '@/lib/calendar/google/channels'
import {
  getGoogleCalendarOauthConfig,
} from '@/lib/calendar/google/config'
import { getDbPool } from '@/lib/db/pool'

const RENEWAL_WINDOW_MS = 24 * 60 * 60_000 // renew anything expiring in <24h

export type SetupChannelOutcome =
  | {
      ok: true
      channelId: string
      resourceId: string
      expiresAt: string
    }
  | {
      ok: false
      reason:
        | 'integration_missing'
        | 'integration_disconnected'
        | 'config_missing'
        | 'token_unavailable'
        | 'watch_failed'
      detail?: string
    }

function mintChannelId(): string {
  // Google channel id must be unique per project; use a UUID + ms
  // prefix so renewal cycles never collide and the id is easy to
  // grep in logs.
  return `lc-${randomUUID()}`
}

function mintChannelToken(): string {
  return randomBytes(32).toString('base64url')
}

// Sets up a brand new push-notification channel for the given
// (teacher, calendar). Stops any prior channel on the integration
// first (best-effort). Persists the new triple on the integration row.
export async function setupChannelForIntegration(opts: {
  accountId: string
  externalCalendarId: string
  fetchImpl?: typeof fetch
}): Promise<SetupChannelOutcome> {
  const pool = getDbPool()
  // Read prior channel state so we can stop it after the rotation
  // succeeds. (Stopping the OLD before watching the new would create
  // a deafness window; stopping after the new is hot is safe.)
  const prior = await pool.query(
    `select channel_id, channel_resource_id, sync_state, read_calendar_ids
       from teacher_calendar_integrations where account_id = $1`,
    [opts.accountId],
  )
  if (prior.rows.length === 0) {
    return { ok: false, reason: 'integration_missing' }
  }
  if (String(prior.rows[0].sync_state) === 'disconnected') {
    return { ok: false, reason: 'integration_disconnected' }
  }

  let config
  try {
    config = getGoogleCalendarOauthConfig()
  } catch (e) {
    return {
      ok: false,
      reason: 'config_missing',
      detail: e instanceof Error ? e.message : String(e),
    }
  }
  if (!config) return { ok: false, reason: 'config_missing' }

  // Derive the webhook URL from the redirect URL host. Plan §4.9:
  // `${NEXT_PUBLIC_SITE_URL}/api/calendar/google/webhook`.
  const webhookUrl = new URL(
    '/api/calendar/google/webhook',
    config.redirectUrl,
  ).toString()
  if (!webhookUrl.startsWith('https://')) {
    return { ok: false, reason: 'config_missing', detail: 'webhook URL must be https' }
  }

  const fresh = await ensureFreshAccessToken({
    accountId: opts.accountId,
    fetchImpl: opts.fetchImpl,
  })
  if (!fresh.ok) {
    return {
      ok: false,
      reason: 'token_unavailable',
      detail: `${fresh.reason}${fresh.detail ? `: ${fresh.detail.slice(0, 80)}` : ''}`,
    }
  }

  const channelId = mintChannelId()
  const channelToken = mintChannelToken()
  const watched = await watchChannel({
    accessToken: fresh.accessToken,
    externalCalendarId: opts.externalCalendarId,
    channelId,
    channelToken,
    webhookUrl,
    fetchImpl: opts.fetchImpl,
  })
  if (!watched.ok) {
    return {
      ok: false,
      reason: 'watch_failed',
      detail: describeError(watched.error),
    }
  }

  const expiresAt = new Date(watched.expirationMs).toISOString()
  // Persist new channel triple. last_seen_message_number must reset —
  // the new channel starts its own numbering.
  await pool.query(
    `update teacher_calendar_integrations
        set channel_id = $2,
            channel_resource_id = $3,
            channel_token = $4,
            channel_expires_at = $5::timestamptz,
            last_seen_message_number = null,
            updated_at = now()
      where account_id = $1`,
    [opts.accountId, watched.channelId, watched.resourceId, channelToken, expiresAt],
  )

  // Stop the old channel (best-effort; even if it fails Google will
  // expire it within 7 days).
  const oldChannelId = prior.rows[0].channel_id
    ? String(prior.rows[0].channel_id)
    : null
  const oldResourceId = prior.rows[0].channel_resource_id
    ? String(prior.rows[0].channel_resource_id)
    : null
  if (oldChannelId && oldResourceId) {
    await stopChannel({
      accessToken: fresh.accessToken,
      channelId: oldChannelId,
      resourceId: oldResourceId,
      fetchImpl: opts.fetchImpl,
    }).catch(() => {
      // Swallow — channel will expire on Google's side; the new one
      // is already authoritative.
    })
  }

  return {
    ok: true,
    channelId: watched.channelId,
    resourceId: watched.resourceId,
    expiresAt,
  }
}

export type RenewSweepOutcome = {
  attempted: number
  renewed: number
  failed: number
  details: Array<{
    accountId: string
    externalCalendarId: string
    ok: boolean
    reason?: string
  }>
}

// Cron entry. For every active integration with channel_expires_at
// inside the next 24h (or null channel — never watched), rotate.
//
// Codex D.4 review: SQL filters `cardinality(read_calendar_ids) > 0`
// so the sweep budget isn't burnt on rows that would just be skipped.
//
// One integration may have many read_calendar_ids; we currently
// watch the FIRST one only. Google's `events.watch` is bound to a
// single `calendarId`, so other read calendars receive no realtime
// push — they're only refreshed by the periodic pull cron (5-min
// cadence). Multi-calendar fan-out (one channel per calendar) is a
// future wave when the operator opts more than one calendar in.
export async function renewExpiringChannels(opts?: {
  nowMs?: number
  fetchImpl?: typeof fetch
  limit?: number
}): Promise<RenewSweepOutcome> {
  const pool = getDbPool()
  const limit = opts?.limit ?? 100
  const result = await pool.query(
    `select account_id, read_calendar_ids
       from teacher_calendar_integrations
      where sync_state in ('active', 'degraded')
        and (channel_expires_at is null or channel_expires_at < now() + interval '24 hours')
        and cardinality(read_calendar_ids) > 0
      order by coalesce(channel_expires_at, '-infinity') asc
      limit $1`,
    [limit],
  )

  const outcome: RenewSweepOutcome = {
    attempted: 0,
    renewed: 0,
    failed: 0,
    details: [],
  }
  for (const row of result.rows) {
    const accountId = String(row.account_id)
    const cals = Array.isArray(row.read_calendar_ids)
      ? (row.read_calendar_ids as string[])
      : []
    if (cals.length === 0) continue
    // Watch the first read calendar. (Multi-calendar fan-out
    // deferred — each channels.watch is bound to ONE calendar; the
    // worker pulls all read_calendar_ids on every wake regardless.)
    const externalCalendarId = String(cals[0])
    outcome.attempted++
    const res = await setupChannelForIntegration({
      accountId,
      externalCalendarId,
      fetchImpl: opts?.fetchImpl,
    })
    if (res.ok) {
      outcome.renewed++
      outcome.details.push({ accountId, externalCalendarId, ok: true })
    } else {
      outcome.failed++
      outcome.details.push({
        accountId,
        externalCalendarId,
        ok: false,
        reason: res.reason,
      })
    }
  }
  return outcome
}

function describeError(error: WatchChannelError): string {
  if (error.kind === 'http') return `http ${error.status}: ${error.body.slice(0, 80)}`
  if (error.kind === 'network') return `network: ${error.message}`
  return `shape: ${error.message}`
}
