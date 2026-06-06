// BCS-DEF-4-PUSH (2026-06-06) — .mjs port of lib/audit/pool.ts.
// Scheduler-side writers (push-events.mjs) use this to INSERT into
// auth_audit_events via the dedicated `levelchannel_audit_writer`
// role (mig 0029) when AUDIT_DATABASE_URL is set; otherwise fall back
// to the primary DATABASE_URL pool.
//
// Plan: docs/plans/bcs-def-4-push-pwa-reminders.md §3.11

import pg from 'pg'

const AUDIT_POOL_MAX = 4

let auditPool = null
let primaryPool = null

function resolveSslConfig(connectionString) {
  if (process.env.NODE_ENV === 'production') {
    return { rejectUnauthorized: false }
  }
  if (/sslmode=require/i.test(connectionString)) {
    return { rejectUnauthorized: false }
  }
  return false
}

function readAuditDatabaseUrl() {
  const url = String(process.env.AUDIT_DATABASE_URL ?? '').trim()
  return url.length > 0 ? url : null
}

function readPrimaryDatabaseUrl() {
  const url = String(process.env.DATABASE_URL ?? '').trim()
  return url.length > 0 ? url : null
}

export function getAuditPool() {
  const dedicatedUrl = readAuditDatabaseUrl()
  if (!dedicatedUrl) {
    if (primaryPool) return primaryPool
    const primaryUrl = readPrimaryDatabaseUrl()
    if (!primaryUrl) return null
    primaryPool = new pg.Pool({
      connectionString: primaryUrl,
      ssl: resolveSslConfig(primaryUrl),
    })
    primaryPool.on('error', (err) => {
      console.warn(
        '[audit-pool.mjs] primary pool background error:',
        err instanceof Error ? err.message : err,
      )
    })
    return primaryPool
  }

  if (!auditPool) {
    auditPool = new pg.Pool({
      connectionString: dedicatedUrl,
      max: AUDIT_POOL_MAX,
      ssl: resolveSslConfig(dedicatedUrl),
    })
    auditPool.on('error', (err) => {
      console.warn(
        '[audit-pool.mjs] background error:',
        err instanceof Error ? err.message : err,
      )
    })
  }
  return auditPool
}
