// Loopback / localhost classification — two helpers, two trust boundaries.
//
// STRICT (`isLiteralLoopbackHostname`):
//   - localhost, 127.0.0.1, ::1, [::1].
//   - For surfaces where "request came from this box" is the gate.
//   - Used by lib/db/pool.ts (TLS strictness) + lib/api/cron-auth.ts
//     (cron Host-header auth boundary).
//   - Excludes *.localhost — would let `Host: tenant.localhost:3000`
//     bypass the cron-auth 404 path and reach the bearer-secret check.
//   - Excludes 0.0.0.0 — means "any IP" in client/Host context, not
//     a real loopback signal there.
//
// WIDE (`isLoopbackOriginHostname` / `isLoopbackOriginUrl`):
//   - STRICT set + 0.0.0.0 + *.localhost (per RFC 6761 §6.3).
//   - For validating "this URL is not a real production target" —
//     rejecting bad NEXT_PUBLIC_SITE_URL / GOOGLE_CALENDAR_REDIRECT_URL.
//   - `*.localhost` resolves to loopback per RFC 6761 §6.3 on all
//     mainstream OS resolvers; a `https://tenant.localhost:3000`
//     siteUrl is equivalent to `https://localhost:3000` for the
//     attacker boundary.
//   - 0.0.0.0 in URL context would point at the local box.
//
// NEVER include `*.local` in either — Codex audit found attacker-
// controlled mDNS (`db.attacker.local`) bypasses production TLS / origin
// checks. The 2026-05-?? removal of `*.local` from lib/db/pool.ts came
// from that finding.

const LITERAL_LOOPBACK_HOSTNAMES = new Set<string>([
  'localhost',
  '127.0.0.1',
  '::1',
  '[::1]',
])

export function isLiteralLoopbackHostname(
  hostname: string | null | undefined,
): boolean {
  if (!hostname) return false
  const lower = hostname.toLowerCase()
  if (LITERAL_LOOPBACK_HOSTNAMES.has(lower)) return true
  if (lower.startsWith('[') && lower.endsWith(']')) {
    if (LITERAL_LOOPBACK_HOSTNAMES.has(lower.slice(1, -1))) return true
  }
  return false
}

export function isLoopbackOriginHostname(
  hostname: string | null | undefined,
): boolean {
  if (!hostname) return false
  const lower = hostname.toLowerCase()
  if (isLiteralLoopbackHostname(lower)) return true
  if (lower === '0.0.0.0') return true
  if (lower.endsWith('.localhost')) return true
  return false
}

export function isLoopbackOriginUrl(url: string | URL): boolean {
  try {
    const u = typeof url === 'string' ? new URL(url) : url
    return isLoopbackOriginHostname(u.hostname)
  } catch {
    return false
  }
}
