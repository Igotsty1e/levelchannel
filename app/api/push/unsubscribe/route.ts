import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { requireLearnerArchetypeAndVerified } from '@/lib/auth/guards'
import { getAuthPool } from '@/lib/auth/pool'
import { isUndefinedTableError } from '@/lib/db/errors'
import { recordPushSubscriptionUnsubscribedUser } from '@/lib/audit/push-events'
import { enforceAccountRateLimit } from '@/lib/security/account-rate-limit'
import { enforceTrustedBrowserOrigin, getClientIp } from '@/lib/security/request'

// BCS-DEF-4-PUSH (2026-06-06) — POST /api/push/unsubscribe.
//
// User-initiated unsubscribe. INTENTIONALLY NOT gated by the master
// switch — users must always be able to delete their stored endpoint
// (privacy/ownership invariant). INTENTIONALLY NOT gated by the host
// allowlist either — round-10 self-review WARN 1: tightening the
// subscribe allowlist later (e.g. removing a deprecated provider)
// must not orphan legacy rows from the delete path.
//
// Plan: docs/plans/bcs-def-4-push-pwa-reminders.md §3.8

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_ENDPOINT_LEN = 8 * 1024

function parseBody(raw: unknown): { endpoint: string } | null {
  if (raw == null || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (typeof o.endpoint !== 'string') return null
  return { endpoint: o.endpoint }
}

export async function POST(request: Request): Promise<Response> {
  const origin = enforceTrustedBrowserOrigin(request)
  if (origin) return origin

  const auth = await requireLearnerArchetypeAndVerified(request)
  if (!auth.ok) return auth.response

  const rl = await enforceAccountRateLimit(
    auth.account.id,
    'push:unsubscribe',
    30,
    60_000,
  )
  if (rl) return rl

  let body: { endpoint: string } | null = null
  try {
    body = parseBody(await request.json())
  } catch {
    body = null
  }
  if (!body) {
    return NextResponse.json(
      { error: 'invalid_body' },
      { status: 400, headers: NO_STORE },
    )
  }
  const endpoint = body.endpoint.trim()
  if (endpoint.length === 0 || endpoint.length > MAX_ENDPOINT_LEN) {
    return NextResponse.json(
      { error: 'invalid_endpoint' },
      { status: 400, headers: NO_STORE },
    )
  }
  try {
    const u = new URL(endpoint)
    if (u.protocol !== 'https:') {
      return NextResponse.json(
        { error: 'invalid_endpoint' },
        { status: 400, headers: NO_STORE },
      )
    }
  } catch {
    return NextResponse.json(
      { error: 'invalid_endpoint' },
      { status: 400, headers: NO_STORE },
    )
  }

  const pool = getAuthPool()
  const clientIp = getClientIp(request)
  const accountId = auth.account.id
  const accountEmail = auth.account.email

  const client = await pool.connect()
  try {
    try {
      await client.query('BEGIN')
      await client.query(
        `SELECT pg_advisory_xact_lock(hashtextextended('push_sub:' || $1, 0))`,
        [endpoint],
      )
      const updRes = await client.query(
        `UPDATE learner_push_subscriptions
            SET unsubscribed_at = now(), updated_at = now()
          WHERE account_id = $1::uuid
            AND endpoint = $2::text
            AND unsubscribed_at IS NULL
          RETURNING id`,
        [accountId, endpoint],
      )
      await client.query('COMMIT')

      if (updRes.rowCount && updRes.rowCount > 0) {
        await recordPushSubscriptionUnsubscribedUser({
          accountId,
          email: accountEmail,
          clientIp,
          userAgent: request.headers.get('user-agent'),
          endpoint,
        })
      }

      return NextResponse.json(
        { ok: true },
        { status: 200, headers: NO_STORE },
      )
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      if (isUndefinedTableError(err)) {
        return NextResponse.json(
          { error: 'migration_pending' },
          { status: 503, headers: NO_STORE },
        )
      }
      throw err
    }
  } finally {
    client.release()
  }
}
