// BCS-OP-ROLLOUT plan §4.2 — two-layer cron route gate.
//
// /api/cron/calendar/* routes are reachable from systemd timers via
// http://127.0.0.1:3000/api/cron/calendar/<target>, NEVER from the
// public internet. Two-layer defense:
//
//   1. Loopback-Host check — the request's `Host` header must be
//      `127.0.0.1:<port>`, `localhost:<port>`, OR an explicitly-allowed
//      entry from CRON_TRUSTED_HOST. nginx terminates TLS on prod and
//      forwards `Host: levelchannel.ru` to the upstream — external
//      callers get 404 (not 401) to avoid revealing the route exists.
//
//   2. Bearer secret — after the host check passes, the
//      `Authorization: Bearer ${CRON_SHARED_SECRET}` header must match.
//      Mismatch → 401.
//
// Both checks return short-circuit Response objects suitable for direct
// return from route handlers. null = passed both gates → continue.

import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'

const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

function parseHostHeader(rawHost: string | null): string | null {
  if (!rawHost) return null
  // Strip optional :port → keep hostname only.
  // IPv6 form: [::1]:3000 → extract [::1] from front.
  if (rawHost.startsWith('[')) {
    const closeIdx = rawHost.indexOf(']')
    if (closeIdx > 0) return rawHost.slice(0, closeIdx + 1)
    return rawHost
  }
  const colonIdx = rawHost.lastIndexOf(':')
  if (colonIdx < 0) return rawHost
  return rawHost.slice(0, colonIdx)
}

function trustedHostnames(): Set<string> {
  // CRON_TRUSTED_HOST is comma-separated hostnames; whitespace stripped.
  // Empty / unset → loopback-only.
  const raw = process.env.CRON_TRUSTED_HOST ?? ''
  const entries = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  return new Set(entries)
}

export function requireCronSecret(request: Request): Response | null {
  // Layer 1: Host gate.
  const hostname = parseHostHeader(request.headers.get('host'))
  const trusted = trustedHostnames()
  const hostOk =
    (hostname !== null && LOOPBACK_HOSTNAMES.has(hostname))
    || (hostname !== null && trusted.has(hostname))
  if (!hostOk) {
    // 404, NOT 401. Don't reveal the route exists to external callers.
    return NextResponse.json(
      { error: 'not_found' },
      { status: 404, headers: NO_STORE },
    )
  }

  // Layer 2: Bearer.
  const secret = process.env.CRON_SHARED_SECRET ?? ''
  if (!secret) {
    // Server misconfiguration — env var unset. Treat as 503 so the
    // cron runner logs a clear error instead of silent-allow.
    return NextResponse.json(
      { error: 'cron_secret_unset' },
      { status: 503, headers: NO_STORE },
    )
  }
  const auth = request.headers.get('authorization') ?? ''
  const expected = `Bearer ${secret}`
  // Constant-time compare to avoid timing-leaks. Lengths differ →
  // short-circuit at the first byte.
  if (!constantTimeEqual(auth, expected)) {
    return NextResponse.json(
      { error: 'unauthorized' },
      { status: 401, headers: NO_STORE },
    )
  }

  return null
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}
