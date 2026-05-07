import { Pool } from 'pg'

import { getDbPoolOrNull, resolveSslConfig } from '@/lib/db/pool'

// Wave 3 #2 — narrower DB role for audit recorders.
//
// When `AUDIT_DATABASE_URL` is set, the audit recorders go through a
// dedicated pool authenticated as the `levelchannel_audit_writer`
// role. That role has INSERT-only grants on `payment_audit_events`
// and `auth_audit_events` (see migration 0029). A SQL-injection bug
// elsewhere in the app cannot tamper with audit history through this
// connection — even though that elsewhere code has full grants on
// its own primary URL.
//
// When `AUDIT_DATABASE_URL` is unset (local dev, or pre-rollout
// production) the recorders fall back to the shared primary pool
// from `lib/db/pool.ts`. That preserves the historical contract:
// audit writes are best-effort and silently no-op when the DB is
// unreachable. Operator can stage the rollout — deploy this code
// first, then add `AUDIT_DATABASE_URL` once the role + password
// are in place per migration 0029's header.
//
// The audit pool is small on purpose. INSERT-only writes are fast
// (single round-trip, no transactions held open), so 4 connections
// is enough for any realistic audit volume; the upper bound on
// audit recorder concurrency is the request rate of the app itself,
// and we want to leave the bulk of Postgres connection budget for
// the primary pool.

declare global {
  // eslint-disable-next-line no-var
  var __levelchannelAuditPool: Pool | undefined
}

const AUDIT_POOL_MAX = 4

function readAuditDatabaseUrl(): string | null {
  const url = process.env.AUDIT_DATABASE_URL?.trim() || ''
  return url.length > 0 ? url : null
}

export function getAuditPool(): Pool | null {
  const dedicatedUrl = readAuditDatabaseUrl()
  if (!dedicatedUrl) {
    // Pre-rollout / local dev fallback. Same OrNull contract as
    // before this wave landed: returns null when no DATABASE_URL.
    return getDbPoolOrNull()
  }

  if (!global.__levelchannelAuditPool) {
    global.__levelchannelAuditPool = new Pool({
      connectionString: dedicatedUrl,
      max: AUDIT_POOL_MAX,
      ssl: resolveSslConfig(dedicatedUrl),
    })
    // Best-effort error trap. The recorder swallows failures already,
    // but a pool-level error (e.g. background reconnection failing)
    // should at least surface in journalctl.
    global.__levelchannelAuditPool.on('error', (err) => {
      console.warn(
        '[audit-pool] background error:',
        err instanceof Error ? err.message : err,
      )
    })
  }
  return global.__levelchannelAuditPool
}
