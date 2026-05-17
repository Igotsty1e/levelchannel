import { NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'

import { NO_STORE } from '@/lib/api/http-headers'
import {
  getCalendarEncryptionKey,
  getCalendarEncryptionKeyOld,
} from '@/lib/calendar/encryption'
import { getDbPool } from '@/lib/db/pool'
import { enforceRateLimit } from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// POST /api/calendar/google/webhook
//
// Google's calendar `channels.watch` push-notification handler. Plan
// §4.9 security contract:
//   1. Read X-Goog-{Channel-Token, Channel-ID, Resource-ID, Resource-State,
//      Message-Number} headers.
//   2. SELECT teacher_calendar_integrations WHERE channel_id=$1 FOR UPDATE.
//   3. Constant-time compare channel_token. Mismatch → 200 silent drop.
//   4. Verify X-Goog-Resource-ID matches stored channel_resource_id. Mismatch
//      → 200 silent drop.
//   5. Monotonic guard: X-Goog-Message-Number > last_seen_message_number.
//      Lower or equal → 200 silent drop (replay/out-of-order).
//   6. SAME transaction: update last_seen_message_number AND INSERT
//      calendar_pull_jobs (priority=2) ON CONFLICT DO NOTHING.
//   7. `sync` resource-state is the channel-created handshake → no-op
//      (apart from the message-number bump).
//
// Why all failures are 200 silent: Google retries on any non-2xx. A
// 401/403 here would burn delivery budget. The state nonce + channel
// id + resource id + message number invariants together stop replay
// + key-leak floods.

const ALLOWED_RESOURCE_STATES = new Set([
  'sync',
  'exists',
  'update',
  'delete',
  'not_exists',
])

function silentOk(): NextResponse {
  // Return 200 to keep Google's delivery budget. The endpoint is
  // hint-only — the real source of truth is the periodic pull.
  return NextResponse.json({ ok: true }, { status: 200, headers: NO_STORE })
}

function constantTimeEqualStr(a: string, b: string): boolean {
  // Equal-length compare; otherwise short-circuit. timingSafeEqual
  // throws on length mismatch.
  if (a.length !== b.length) return false
  return timingSafeEqual(Buffer.from(a), Buffer.from(b))
}

export async function POST(request: Request) {
  // Rate-limit per-IP. Google's edge is constant so this defends
  // against direct attacker hits more than against legit Google traffic.
  const rl = await enforceRateLimit(
    request,
    'calendar:google:webhook:ip',
    300,
    60_000,
  )
  if (rl) return silentOk() // even rate-limit failures → silent 200

  const channelId = request.headers.get('x-goog-channel-id') ?? ''
  const channelToken = request.headers.get('x-goog-channel-token') ?? ''
  const resourceId = request.headers.get('x-goog-resource-id') ?? ''
  const resourceState = request.headers.get('x-goog-resource-state') ?? ''
  const messageNumberStr = request.headers.get('x-goog-message-number') ?? ''

  if (!channelId || !channelToken || !resourceId || !resourceState) {
    return silentOk()
  }
  if (!ALLOWED_RESOURCE_STATES.has(resourceState)) {
    return silentOk()
  }
  const messageNumber = Number(messageNumberStr)
  if (
    !Number.isFinite(messageNumber)
    || messageNumber <= 0
    || !Number.isInteger(messageNumber)
  ) {
    return silentOk()
  }

  const pool = getDbPool()
  // AUDIT-SEC-4 (2026-05-17) — decrypt-aware read. Prefer the
  // encrypted column; fall back to plaintext channel_token for rows
  // written before migration 0054 landed (Phase A). After Phase B
  // nulls plaintext for migrated rows, the encrypted branch is
  // load-bearing. Keys may be null in dev/test; pgp_sym_decrypt_either
  // returns NULL on null PRIMARY or wrong-key, never throws — the
  // COALESCE then degrades to the plaintext column safely.
  let encKey: string | null = null
  let encKeyOld: string | null = null
  try {
    encKey = getCalendarEncryptionKey()
    encKeyOld = getCalendarEncryptionKeyOld()
  } catch {
    // In production the resolver throws if CALENDAR_ENCRYPTION_KEY is
    // unset. Treat as null: legacy plaintext rows still match; new
    // dual-write rows silent-drop (the right failure mode — preserves
    // the existing anti-probe shape).
    encKey = null
    encKeyOld = null
  }
  const client = await pool.connect()
  try {
    await client.query('begin')
    const lookup = await client.query(
      `select account_id,
              coalesce(
                case when channel_token_enc is null then null
                     else pgp_sym_decrypt_either(channel_token_enc, $2::text, $3::text)
                end,
                channel_token
              ) as channel_token,
              channel_resource_id,
              last_seen_message_number, read_calendar_ids,
              channel_expires_at, sync_state
         from teacher_calendar_integrations
        where channel_id = $1
        for update`,
      [channelId, encKey, encKeyOld],
    )
    if (lookup.rows.length === 0) {
      await client.query('commit')
      return silentOk()
    }
    const row = lookup.rows[0]
    const expectedToken = row.channel_token ? String(row.channel_token) : ''
    const expectedResourceId = row.channel_resource_id
      ? String(row.channel_resource_id)
      : ''
    if (!expectedToken || !constantTimeEqualStr(channelToken, expectedToken)) {
      await client.query('commit')
      return silentOk()
    }
    if (!expectedResourceId || expectedResourceId !== resourceId) {
      await client.query('commit')
      return silentOk()
    }
    const lastSeen =
      row.last_seen_message_number === null
        ? 0
        : Number(row.last_seen_message_number)
    if (messageNumber <= lastSeen) {
      // Replay / out-of-order — drop silently.
      await client.query('commit')
      return silentOk()
    }
    // Channel may be past expiry; we still process (Google may send
    // stale tail) but record it for the renewal sweep.
    const channelExpiresAt = row.channel_expires_at
      ? new Date(String(row.channel_expires_at))
      : null
    const channelStale = channelExpiresAt && channelExpiresAt.getTime() < Date.now()

    // Bump last_seen_message_number always — keeps the monotonic
    // guard honest even on `sync` handshake messages.
    await client.query(
      `update teacher_calendar_integrations
          set last_seen_message_number = $2,
              updated_at = now()
        where account_id = $1`,
      [row.account_id, messageNumber],
    )

    // `sync` is the channel-created handshake; everything else
    // enqueues a pull job for each read calendar.
    if (resourceState !== 'sync' && !channelStale) {
      if (row.sync_state !== 'disconnected') {
        const calendars = Array.isArray(row.read_calendar_ids)
          ? (row.read_calendar_ids as string[])
          : []
        for (const calendarId of calendars) {
          // Codex D.complete review: webhook is realtime priority=2.
          // DO NOTHING was too weak — a pending job with backoff-
          // pushed next_run_at would silently swallow the upgrade.
          // DO UPDATE: pull next_run_at forward, raise priority.
          await client.query(
            `insert into calendar_pull_jobs
                (teacher_account_id, external_calendar_id, priority, status, next_run_at)
             values ($1, $2, 2, 'pending', now())
             on conflict (teacher_account_id, external_calendar_id) where status='pending'
               do update set
                 next_run_at = least(calendar_pull_jobs.next_run_at, excluded.next_run_at),
                 priority    = greatest(calendar_pull_jobs.priority, excluded.priority)`,
            [String(row.account_id), calendarId],
          )
        }
      }
    }

    await client.query('commit')
    return silentOk()
  } catch (e) {
    await client.query('rollback').catch(() => {})
    // Don't leak errors. Google retries; we'll see the next message.
    console.error('[calendar/webhook] error:', e)
    return silentOk()
  } finally {
    client.release()
  }
}
