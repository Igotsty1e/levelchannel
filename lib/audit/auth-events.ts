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
  // SAAS-3+4 TINV.1 (2026-05-18) — teacher self-reg + invite events.
  // SQL CHECK constraint mirror lives in migrations/0057_teacher_invites.sql.
  // Drift between this tuple and the CHECK is caught by
  // tests/integration/auth/auth-audit-event-types-drift.test.ts (TINV.6.6).
  'auth.teacher.self_registered',
  'auth.invite.created',
  'auth.invite.revoked',
  'auth.invite.redeemed',
  // SAAS-OFFER bundle Sub-A.2 round-1 WARN#5 closure (2026-05-30) —
  // mirror of the auth_audit_events.event_type CHECK widened by mig
  // 0096. The accept handler (app/api/teacher/saas-offer-accept) will
  // write `saas_offer_accepted` events in the follow-up wave (this
  // foundation PR ships only the schema + types; the route writes a
  // consent row via recordConsent, not yet an audit row). The
  // `_backfilled` event fires from scripts/saas-offer-backfill.mjs in
  // Sub-A.5. Pinning both here closes the drift hazard between SQL
  // CHECK and TS allowlist before the writer paths land.
  'auth.teacher.saas_offer_accepted',
  'auth.teacher.saas_offer_backfilled',
  // T3 Sub-PR A (2026-06-01) — mirror SQL CHECK extensions.
  // Closes the pre-existing drift surfaced by codex-paranoia rounds 6+7
  // (R6-WARN#3 + R7-WARN#2): two events live in SQL since mig 0100/0101
  // but were missing from this TS tuple; plus 4 new T3 events shipped
  // by mig 0102.
  'auth.onboarding.reset',          // mig 0100
  'auth.billing.method_changed',    // mig 0101
  'auth.tariff_access.granted',     // mig 0102 (T3)
  'auth.tariff_access.revoked',     // mig 0102 (T3)
  'auth.package_access.granted',    // mig 0102 (T3)
  'auth.package_access.revoked',    // mig 0102 (T3)
  // BCS-DEF-4-PUSH (2026-06-06) — mirror SQL CHECK widened by mig 0108.
  // Five push.subscription.* events for Web Push lifecycle:
  // created (first INSERT), reassigned (cross-account flip),
  // revived (same-account dormant resub), unsubscribed.user (user delete),
  // unsubscribed.auto (scheduler 410/404 or cap eviction).
  'push.subscription.created',
  'push.subscription.reassigned',
  'push.subscription.revived',
  'push.subscription.unsubscribed.user',
  'push.subscription.unsubscribed.auto',
  // 2026-06-09 — in-cabinet password change (mig 0121).
  'password.changed.in_cabinet',
  'password.changed.in_cabinet.bad_current',
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
