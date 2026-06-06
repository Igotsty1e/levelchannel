import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { resolveOperatorSetting } from '@/lib/admin/operator-settings'
import { requireLearnerArchetypeAndVerified } from '@/lib/auth/guards'
import { getAuthPool } from '@/lib/auth/pool'
import { isUndefinedTableError } from '@/lib/db/errors'
import { isAllowedPushEndpoint } from '@/lib/notifications/push-provider-allowlist'
import {
  recordPushSubscriptionCapEvicted,
  recordPushSubscriptionCreated,
  recordPushSubscriptionReassigned,
  recordPushSubscriptionRevived,
} from '@/lib/audit/push-events'
import { enforceAccountRateLimit } from '@/lib/security/account-rate-limit'
import { enforceTrustedBrowserOrigin, getClientIp } from '@/lib/security/request'

// BCS-DEF-4-PUSH (2026-06-06) — POST /api/push/subscribe.
//
// Stores a learner's Web Push subscription (endpoint + p256dh + auth).
// Active endpoint is globally UNIQUE — handles same-account key-refresh
// (UPDATE in place), same-account revive (resurrect dormant row), and
// cross-account reassignment (flip displaced row to unsubscribed_at,
// audit). Enforces per-account cap of 10 active subs (FIFO eviction).
//
// Plan: docs/plans/bcs-def-4-push-pwa-reminders.md §3.8

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_ACTIVE_PUSH_SUBSCRIPTIONS_PER_ACCOUNT = 10
const B64URL_RE = /^[A-Za-z0-9_-]+={0,2}$/
const MAX_ENDPOINT_LEN = 8 * 1024
const MIN_P256DH_LEN = 80
const MIN_AUTH_LEN = 20

type SubscribeBody = {
  endpoint: string
  p256dh: string
  auth: string
  userAgent?: string
}

function parseBody(raw: unknown): SubscribeBody | null {
  if (raw == null || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (typeof o.endpoint !== 'string') return null
  if (typeof o.p256dh !== 'string') return null
  if (typeof o.auth !== 'string') return null
  if (o.userAgent !== undefined && typeof o.userAgent !== 'string') return null
  return {
    endpoint: o.endpoint,
    p256dh: o.p256dh,
    auth: o.auth,
    userAgent: typeof o.userAgent === 'string' ? o.userAgent : undefined,
  }
}

export async function POST(request: Request): Promise<Response> {
  // 1. Master-switch gate (fail-closed on dbErrored — guards.ts:312 pattern).
  const setting = await resolveOperatorSetting(
    'LEARNER_REMINDERS_PUSH_ENABLED',
  )
  if (setting.dbErrored || setting.value !== 1) {
    return NextResponse.json(
      { error: 'push_disabled' },
      { status: 503, headers: NO_STORE },
    )
  }
  const vapidPublicKey = (process.env.PUSH_VAPID_PUBLIC_KEY ?? '').trim()
  const vapidPrivateKey = (process.env.PUSH_VAPID_PRIVATE_KEY ?? '').trim()
  const vapidSubject = (process.env.PUSH_VAPID_SUBJECT ?? '').trim()
  if (!vapidPublicKey || !vapidPrivateKey || !vapidSubject) {
    return NextResponse.json(
      { error: 'push_disabled' },
      { status: 503, headers: NO_STORE },
    )
  }

  // 2. Perimeter: origin + archetype + per-account rate-limit.
  const origin = enforceTrustedBrowserOrigin(request)
  if (origin) return origin

  const auth = await requireLearnerArchetypeAndVerified(request)
  if (!auth.ok) return auth.response

  const rl = await enforceAccountRateLimit(
    auth.account.id,
    'push:subscribe',
    30,
    60_000,
  )
  if (rl) return rl

  // 3. Body.
  let body: SubscribeBody | null = null
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
  const p256dh = body.p256dh.trim()
  const authKey = body.auth.trim()
  const userAgent = (body.userAgent ?? '').trim().slice(0, 500) || null

  if (endpoint.length === 0 || endpoint.length > MAX_ENDPOINT_LEN) {
    return NextResponse.json(
      { error: 'invalid_endpoint' },
      { status: 400, headers: NO_STORE },
    )
  }
  if (!isAllowedPushEndpoint(endpoint)) {
    return NextResponse.json(
      { error: 'invalid_endpoint' },
      { status: 400, headers: NO_STORE },
    )
  }
  if (!B64URL_RE.test(p256dh) || p256dh.length < MIN_P256DH_LEN) {
    return NextResponse.json(
      { error: 'invalid_p256dh' },
      { status: 400, headers: NO_STORE },
    )
  }
  if (!B64URL_RE.test(authKey) || authKey.length < MIN_AUTH_LEN) {
    return NextResponse.json(
      { error: 'invalid_auth' },
      { status: 400, headers: NO_STORE },
    )
  }

  const pool = getAuthPool()
  const clientIp = getClientIp(request)
  const accountId = auth.account.id
  const accountEmail = auth.account.email

  // 4. Transactional write — advisory lock on the endpoint string.
  const client = await pool.connect()
  try {
    try {
      await client.query('BEGIN')
      await client.query(
        `SELECT pg_advisory_xact_lock(hashtextextended('push_sub:' || $1, 0))`,
        [endpoint],
      )

      const activeRes = await client.query(
        `SELECT id, account_id
           FROM learner_push_subscriptions
          WHERE endpoint = $1 AND unsubscribed_at IS NULL
          LIMIT 1`,
        [endpoint],
      )

      let displacedOldAccountId: string | null = null
      let outcome: 'key_refresh' | 'created' | 'revived' = 'created'
      let resultRowId: string | null = null

      if (activeRes.rows.length > 0) {
        const row = activeRes.rows[0]
        const existingId = String(row.id)
        const existingAccountId = String(row.account_id)
        if (existingAccountId !== accountId) {
          // Cross-account reassign: displace the existing row.
          await client.query(
            `UPDATE learner_push_subscriptions
                SET unsubscribed_at = now(), updated_at = now()
              WHERE id = $1::bigint`,
            [existingId],
          )
          displacedOldAccountId = existingAccountId
          // Fall through to the cap check + insert below.
        } else {
          // Same-account key refresh.
          await client.query(
            `UPDATE learner_push_subscriptions
                SET p256dh_b64url = $2::text,
                    auth_b64url = $3::text,
                    user_agent = $4::text,
                    updated_at = now()
              WHERE id = $1::bigint`,
            [existingId, p256dh, authKey, userAgent],
          )
          await client.query('COMMIT')
          return NextResponse.json(
            { ok: true, subscriptionId: existingId, outcome: 'key_refresh' },
            { status: 200, headers: NO_STORE },
          )
        }
      }

      // Cap enforcement before insert/revive.
      const countRes = await client.query(
        `SELECT COUNT(*)::int AS n
           FROM learner_push_subscriptions
          WHERE account_id = $1::uuid AND unsubscribed_at IS NULL`,
        [accountId],
      )
      const activeCount = Number(countRes.rows[0]?.n ?? 0)
      let capEvictedEndpoint: string | null = null
      if (activeCount >= MAX_ACTIVE_PUSH_SUBSCRIPTIONS_PER_ACCOUNT) {
        const evictRes = await client.query(
          `UPDATE learner_push_subscriptions
              SET unsubscribed_at = now(), updated_at = now()
            WHERE id = (
              SELECT id FROM learner_push_subscriptions
               WHERE account_id = $1::uuid AND unsubscribed_at IS NULL
               ORDER BY id ASC LIMIT 1
            )
            RETURNING endpoint`,
          [accountId],
        )
        capEvictedEndpoint = evictRes.rows[0]?.endpoint
          ? String(evictRes.rows[0].endpoint)
          : null
      }

      // Try to revive a dormant same-account row first.
      const reviveRes = await client.query(
        `SELECT id FROM learner_push_subscriptions
          WHERE account_id = $1::uuid AND endpoint = $2
          ORDER BY id DESC LIMIT 1`,
        [accountId, endpoint],
      )
      if (reviveRes.rows.length > 0) {
        const reviveId = String(reviveRes.rows[0].id)
        await client.query(
          `UPDATE learner_push_subscriptions
              SET unsubscribed_at = NULL,
                  p256dh_b64url = $2::text,
                  auth_b64url = $3::text,
                  user_agent = $4::text,
                  last_status_code = NULL,
                  last_error = NULL,
                  updated_at = now()
            WHERE id = $1::bigint`,
          [reviveId, p256dh, authKey, userAgent],
        )
        resultRowId = reviveId
        outcome = 'revived'
      } else {
        const insertRes = await client.query(
          `INSERT INTO learner_push_subscriptions
             (account_id, endpoint, p256dh_b64url, auth_b64url, user_agent)
           VALUES ($1::uuid, $2::text, $3::text, $4::text, $5::text)
           RETURNING id`,
          [accountId, endpoint, p256dh, authKey, userAgent],
        )
        resultRowId = String(insertRes.rows[0].id)
        outcome = 'created'
      }

      await client.query('COMMIT')

      // 5. Audit events post-commit (best-effort, never blocks success).
      if (displacedOldAccountId) {
        await recordPushSubscriptionReassigned({
          newAccountId: accountId,
          newEmail: accountEmail,
          oldAccountId: displacedOldAccountId,
          endpoint,
          clientIp,
          userAgent,
        })
      }
      if (capEvictedEndpoint) {
        await recordPushSubscriptionCapEvicted({
          accountId,
          endpoint: capEvictedEndpoint,
        })
      }
      if (outcome === 'revived') {
        await recordPushSubscriptionRevived({
          accountId,
          email: accountEmail,
          clientIp,
          userAgent,
          endpoint,
        })
      } else {
        await recordPushSubscriptionCreated({
          accountId,
          email: accountEmail,
          clientIp,
          userAgent,
          endpoint,
        })
      }

      return NextResponse.json(
        { ok: true, subscriptionId: resultRowId, outcome },
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
