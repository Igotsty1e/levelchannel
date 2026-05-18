import { NextResponse } from 'next/server'

import { takeRateLimit } from '@/lib/security/rate-limit'

// SAAS-3+4 TINV.4-follow-up (2026-05-18) — per-account rate-limit
// helper.
//
// docs/plans/teacher-self-reg-invite.md round-2 WARN#5+#6 closure.
// The default `enforceRateLimit` (in `lib/security/request.ts`) always
// appends `:${ip}` to the key. That's correct for anti-bruteforce
// surfaces (login, register, reset) — the bucket should burn per IP
// so a single attacker can't share their cap across other users.
//
// For per-account caps (invite generation, etc.), IP-keying is the
// wrong unit:
//   - VPN / IP rotation defeats the per-teacher cap.
//   - Multiple legitimate operators behind the same NAT/IP would
//     collide each other.
//
// This helper uses a pure `account:${accountId}:${scope}` key — no IP
// suffix. Reuses the shared `takeRateLimit` backend (Postgres
// `rate_limit_buckets` + in-memory fallback), so the bucket is
// multi-instance-correct when DATABASE_URL is set.
export async function enforceAccountRateLimit(
  accountId: string,
  scope: string,
  limit: number,
  windowMs: number,
) {
  const key = `account:${accountId}:${scope}`
  const result = await takeRateLimit(key, limit, windowMs)

  if (result.allowed) {
    return null
  }

  return NextResponse.json(
    { error: 'Too many requests. Please try again later.' },
    {
      status: 429,
      headers: {
        'Retry-After': String(result.retryAfterSeconds),
        'Cache-Control': 'no-store, max-age=0',
      },
    },
  )
}
