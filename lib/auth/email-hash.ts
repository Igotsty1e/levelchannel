import { createHmac } from 'node:crypto'

import { normalizeAccountEmail } from '@/lib/auth/accounts'

// HMAC-keyed sha256 of a normalized email, used as a stable scope key
// for per-email rate-limiting buckets in lib/security/rate-limit.ts.
//
// Why dedicated AUTH_RATE_LIMIT_SECRET (not TELEMETRY_HASH_SECRET):
// per /plan-eng-review mech-3, the two secrets key different surfaces
// with different rotation cadences. Telemetry secret rotates breaks
// "same email across telemetry events" correlation (acceptable analytics
// drift). Auth rate-limit secret rotates resets per-email counters
// (harmless). Mixing them couples rotation cadences artificially.

function readAuthRateLimitSecret(): string {
  const secret = process.env.AUTH_RATE_LIMIT_SECRET?.trim() || ''
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      // Production assertion — boot fails before this can be called in
      // a real request path, see lib/email/config.ts. This re-check is
      // a defense in depth for unexpected import paths.
      throw new Error(
        'AUTH_RATE_LIMIT_SECRET is required when NODE_ENV=production.',
      )
    }
    // Dev fallback: stable but obviously-non-secret. Means in-memory
    // rate-limit buckets work locally without a real secret. Production
    // is gated above.
    return 'lc-dev-auth-rate-limit-fallback'
  }
  return secret
}

export function hashEmailForRateLimit(email: string): string {
  const normalized = normalizeAccountEmail(email)
  return createHmac('sha256', readAuthRateLimitSecret())
    .update(normalized, 'utf8')
    .digest('hex')
}

// Convenience for building rate-limit scope strings consistently.
//
// Example: rateLimitScope('login', 'user@example.com') → 'auth:login:email:<hash>'
export function rateLimitScope(
  action: 'login' | 'register' | 'reset_request',
  email: string,
): string {
  return `auth:${action}:email:${hashEmailForRateLimit(email)}`
}
