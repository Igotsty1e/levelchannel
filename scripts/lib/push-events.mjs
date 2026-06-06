// BCS-DEF-4-PUSH (2026-06-06) — scheduler-side audit writer for the
// single push event the scheduler emits: `push.subscription.unsubscribed.auto`.
//
// Routes through the dedicated audit pool (scripts/lib/audit-pool.mjs)
// so the `levelchannel_audit_writer` role boundary holds even from
// the scheduler.
//
// Plan: docs/plans/bcs-def-4-push-pwa-reminders.md §3.11

import { getAuditPool } from './audit-pool.mjs'
import { hashEmailForAudit } from './email-hash.mjs'

export async function recordPushSubscriptionUnsubscribedAuto({
  pool,
  accountId,
  endpoint,
  statusCode,
  reason,
}) {
  const auditPool = getAuditPool()
  if (!auditPool) return

  let email = ''
  try {
    const res = await pool.query(
      'SELECT email FROM accounts WHERE id = $1',
      [accountId],
    )
    if (res.rows.length > 0) {
      email = String(res.rows[0].email ?? '')
    }
  } catch (err) {
    console.warn(
      '[push-events.mjs] email lookup failed:',
      err instanceof Error ? err.message : err,
    )
  }

  const emailHash = email ? hashEmailForAudit(email) : ''

  try {
    await auditPool.query(
      `INSERT INTO auth_audit_events
         (event_type, account_id, email_hash, client_ip, user_agent, payload)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        'push.subscription.unsubscribed.auto',
        accountId,
        emailHash,
        null,
        null,
        {
          endpoint_host: safeEndpointHost(endpoint),
          status_code: statusCode ?? null,
          reason: reason ?? 'endpoint_gone',
        },
      ],
    )
  } catch (err) {
    console.warn(
      '[push-events.mjs] audit insert failed:',
      err instanceof Error ? err.message : err,
    )
  }
}

function safeEndpointHost(endpoint) {
  try {
    return new URL(String(endpoint)).hostname
  } catch {
    return ''
  }
}
