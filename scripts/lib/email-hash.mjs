// BCS-DEF-4-PUSH (2026-06-06) — .mjs port of lib/auth/email-hash.ts.
// Used by scheduler-side audit writers (scripts/lib/push-events.mjs)
// to emit `push.subscription.unsubscribed.auto` events with consistent
// hashed email cross-correlation against the TS-side writers.
//
// Drift contract: hashEmailForAudit(e) here MUST equal
// hashEmailForRateLimit(e) in lib/auth/email-hash.ts for the same e.
// Pinned by tests/integration/scripts/email-hash-drift.test.ts.
//
// Plan: docs/plans/bcs-def-4-push-pwa-reminders.md §3.11

import { createHmac } from 'node:crypto'

function readAuthRateLimitSecret() {
  const secret = String(process.env.AUTH_RATE_LIMIT_SECRET ?? '').trim()
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'AUTH_RATE_LIMIT_SECRET is required when NODE_ENV=production.',
      )
    }
    return 'lc-dev-auth-rate-limit-fallback'
  }
  return secret
}

export function normalizeEmail(value) {
  return String(value ?? '').trim().toLowerCase()
}

export function hashEmailForAudit(email) {
  const normalized = normalizeEmail(email)
  return createHmac('sha256', readAuthRateLimitSecret())
    .update(normalized, 'utf8')
    .digest('hex')
}
