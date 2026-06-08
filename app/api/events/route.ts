/**
 * POST /api/events — batch ingest event endpoint.
 *
 * Contract:
 *   Headers:
 *     Cookie: lc_aid=<uuid>:<hmac> (required, signed)
 *     Content-Type: application/json
 *   Body:
 *     {
 *       sent_at: ISO-8601,
 *       batch: [
 *         { event_id, event_name, occurred_at, session_id, url?,
 *           referrer?, properties? }
 *       ]
 *     }
 *
 * Response:
 *   204 — batch accepted (whether all/some/none persisted; client doesn't retry)
 *   400 — body schema invalid (drop, don't retry)
 *   401 — anonymous_id cookie missing/invalid (client should rotate cookie + retry)
 *   429 — rate-limited
 *
 * Fire-and-forget design — client SHOULD NOT block on response.
 * sendBeacon() in particular ignores response entirely.
 */

import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { z } from 'zod'

import { getDbPool } from '@/lib/db/pool'
import { enforceRateLimit, getClientIp } from '@/lib/security/request'
import {
  ANONYMOUS_ID_COOKIE,
  ANONYMOUS_ID_MAX_AGE_SEC,
  clampOccurredAt,
  extractUtm,
  parseUserAgent,
  sanitizeReferrer,
  sanitizeUrl,
  signAnonymousId,
  truncateIp,
  verifySignedAnonymousId,
} from '@/lib/analytics/server'
import { isPageViewAllowed, validateEvent } from '@/lib/analytics/registry'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store' } as const

const ZBatchItem = z.object({
  event_id: z.string().uuid().optional(),
  event_name: z.string().min(1).max(64),
  occurred_at: z.string(),
  session_id: z.string().uuid(),
  url: z.string().max(2048).optional(),
  referrer: z.string().max(2048).optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
})

const ZBody = z.object({
  sent_at: z.string(),
  batch: z.array(ZBatchItem).min(1).max(50),
})

function newAnonymousIdCookie(): string {
  return signAnonymousId(randomUUID())
}

function setAnonymousCookieHeader(value: string): Record<string, string> {
  // SameSite=Lax (top-level navigation only), Secure, не HttpOnly (JS читает).
  const parts = [
    `${ANONYMOUS_ID_COOKIE}=${value}`,
    `Max-Age=${ANONYMOUS_ID_MAX_AGE_SEC}`,
    'Path=/',
    'SameSite=Lax',
    'Secure',
  ]
  return { 'Set-Cookie': parts.join('; ') }
}

export async function POST(request: Request) {
  // Rate limit — hybrid anonymous_id + IP prefix.
  const ip = getClientIp(request) ?? 'unknown'
  const rlIp = await enforceRateLimit(request, `events:ip:${ip}`, 600, 60_000)
  if (rlIp) return rlIp

  // Cookie verification.
  const cookieHeader = request.headers.get('cookie') ?? ''
  const aidRaw = cookieHeader
    .split(/;\s*/)
    .find((c) => c.startsWith(`${ANONYMOUS_ID_COOKIE}=`))
    ?.slice(ANONYMOUS_ID_COOKIE.length + 1)
  const anonymousId = verifySignedAnonymousId(aidRaw)
  if (!anonymousId) {
    // Rotate cookie + 401. Client retries with new aid.
    const newCookie = newAnonymousIdCookie()
    return NextResponse.json(
      { error: 'aid_missing_or_invalid' },
      {
        status: 401,
        headers: { ...NO_STORE, ...setAnonymousCookieHeader(newCookie) },
      },
    )
  }

  const rlAid = await enforceRateLimit(request, `events:aid:${anonymousId}`, 300, 60_000)
  if (rlAid) return rlAid

  // Parse body.
  const text = await request.text()
  if (text.length > 256 * 1024) {
    return NextResponse.json({ error: 'body_too_large' }, { status: 400, headers: NO_STORE })
  }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400, headers: NO_STORE })
  }
  const parsed = ZBody.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400, headers: NO_STORE })
  }
  const { batch } = parsed.data

  // Account id resolution — if there's a session cookie, attach.
  // Done via lazy import to keep this route fast on anonymous-only batches.
  const accountId = await resolveAccountIdFromSession(request).catch(() => null)

  // Pre-process events: validate, normalize, sanitize.
  const serverNow = new Date()
  const ua = request.headers.get('user-agent')
  const parsedUa = parseUserAgent(ua)
  const ipPrefix = truncateIp(ip)

  type EventRow = {
    event_id: string
    occurred_at: Date
    event_name: string
    session_id: string
    url: string | null
    referrer: string | null
    utm: Record<string, string>
    properties: Record<string, unknown>
  }
  const rows: EventRow[] = []
  let dropped = 0

  for (const item of batch) {
    const valid = validateEvent(item.event_name, item.properties)
    if (!valid.ok) {
      dropped++
      continue
    }
    // Special-case: page_view on admin/static/api paths — drop.
    if (valid.name === 'page_view' && item.url && !isPageViewAllowed(item.url)) {
      dropped++
      continue
    }
    const occurredAt = clampOccurredAt(item.occurred_at, serverNow)
    if (!occurredAt) {
      dropped++
      continue
    }
    const eventId = item.event_id ?? randomUUID()
    const sanitizedUrl = sanitizeUrl(item.url)
    const sanitizedReferrer = sanitizeReferrer(item.referrer)
    const utm = extractUtm(item.url)
    rows.push({
      event_id: eventId,
      occurred_at: occurredAt,
      event_name: valid.name,
      session_id: item.session_id,
      url: sanitizedUrl,
      referrer: sanitizedReferrer,
      utm,
      properties: valid.properties,
    })
  }

  if (rows.length === 0) {
    // Все dropped — всё равно 204 (fire-and-forget).
    return new NextResponse(null, { status: 204, headers: NO_STORE })
  }

  // Batch INSERT через jsonb_to_recordset.
  // synchronous_commit=off per-transaction — допускаем 1s loss window
  // на crash в обмен на throughput. События не критичны.
  const pool = getDbPool()
  const client = await pool.connect()
  try {
    await client.query('begin')
    await client.query('set local synchronous_commit = off')
    await client.query(
      `insert into events
         (event_id, occurred_at, event_name, anonymous_id, account_id, session_id,
          url, referrer, utm, ua_family, ua_os, ua_device, ip_prefix, properties)
       select
         (x->>'event_id')::uuid,
         (x->>'occurred_at')::timestamptz,
         x->>'event_name',
         $1::uuid,
         $2::uuid,
         (x->>'session_id')::uuid,
         x->>'url',
         x->>'referrer',
         coalesce((x->'utm')::jsonb, '{}'::jsonb),
         $3,
         $4,
         $5,
         $6::inet,
         coalesce((x->'properties')::jsonb, '{}'::jsonb)
       from jsonb_array_elements($7::jsonb) as x
       on conflict do nothing`,
      [
        anonymousId,
        accountId,
        parsedUa.family,
        parsedUa.os,
        parsedUa.device,
        ipPrefix,
        JSON.stringify(
          rows.map((r) => ({
            event_id: r.event_id,
            occurred_at: r.occurred_at.toISOString(),
            event_name: r.event_name,
            session_id: r.session_id,
            url: r.url,
            referrer: r.referrer,
            utm: r.utm,
            properties: r.properties,
          })),
        ),
      ],
    )
    await client.query('commit')
  } catch {
    await client.query('rollback').catch(() => {})
    // 204 anyway — fire-and-forget. Loss is acceptable; alarmed via metrics.
  } finally {
    client.release()
  }

  return new NextResponse(null, {
    status: 204,
    headers: { ...NO_STORE, 'X-Events-Dropped': String(dropped) },
  })
}

/**
 * Lazy resolver — if request carries a logged-in session, return its
 * account_id. Otherwise null. We don't enforce auth on this endpoint
 * (anonymous events allowed).
 */
async function resolveAccountIdFromSession(request: Request): Promise<string | null> {
  try {
    const { getCurrentSession } = await import('@/lib/auth/sessions')
    const result = await getCurrentSession(request)
    return result?.account.id ?? null
  } catch {
    return null
  }
}
