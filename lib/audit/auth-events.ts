// Wave 5 (security observability) — auth-domain audit recorder.
//
// Sibling of lib/audit/payment-events.ts. Best-effort, swallows
// failures so auth flow is never blocked by an audit-table outage.
// Domain separation rationale lives in migration
// 0028_auth_audit_events.sql.

import { getAuditPool } from '@/lib/audit/pool'
import { hashEmailForRateLimit } from '@/lib/auth/email-hash'

export const AUTH_AUDIT_EVENT_TYPES = [
  'auth.login.success',
  'auth.login.failed',
  'auth.register.created',
  'auth.reset.requested',
  'auth.reset.confirmed',
  'auth.verify.success',
  'auth.session.revoked',
] as const

export type AuthAuditEventType = (typeof AUTH_AUDIT_EVENT_TYPES)[number]

export type AuthAuditFailureReason =
  | 'unknown_email'
  | 'wrong_password'
  | 'disabled_account'
  | 'malformed_email'

export type RecordAuthAuditEvent = {
  eventType: AuthAuditEventType
  // Nullable: failed login on unknown email has no account row. Pass
  // null in that case rather than a placeholder.
  accountId: string | null
  // The raw normalized email. Hashed inside the recorder so callers
  // do not have to thread the HMAC secret through. Required because
  // every auth event happens on an email-bearing flow.
  email: string
  clientIp?: string | null
  userAgent?: string | null
  // Optional reason tag for failed-login telemetry. Kept INTERNAL —
  // the route response stays generic to avoid email enumeration.
  reason?: AuthAuditFailureReason | null
  // Free-form extras. Avoid putting raw email or password material
  // here — the recorder does not strip them.
  payload?: Record<string, unknown>
}

export async function recordAuthAuditEvent(
  event: RecordAuthAuditEvent,
): Promise<boolean> {
  const pool = getAuditPool()
  if (!pool) {
    // No DATABASE_URL — local dev without postgres. Silent skip,
    // matching the payment-events recorder's contract.
    return false
  }

  try {
    const emailHash = hashEmailForRateLimit(event.email)
    const payload = {
      ...(event.payload ?? {}),
      ...(event.reason ? { reason: event.reason } : {}),
    }

    await pool.query(
      `insert into auth_audit_events
         (event_type, account_id, email_hash, client_ip, user_agent, payload)
       values ($1, $2, $3, $4, $5, $6::jsonb)`,
      [
        event.eventType,
        event.accountId,
        emailHash,
        event.clientIp ?? null,
        event.userAgent ?? null,
        JSON.stringify(payload),
      ],
    )
    return true
  } catch (err) {
    console.warn(
      '[auth-audit] insert failed (swallowed):',
      err instanceof Error ? err.message : err,
    )
    return false
  }
}
