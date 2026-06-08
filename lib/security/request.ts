import { NextResponse } from 'next/server'

import { paymentConfig } from '@/lib/payments/config'
import { takeRateLimit } from '@/lib/security/rate-limit'

// Mock: lc_YYYYMMDD_xxxxxxxx (27 символов).
// CloudPayments: lc_ + 18 hex (21 символ).
// Один общий паттерн с верхней границей, чтобы не пускать произвольно длинные id.
const INVOICE_ID_PATTERN = /^lc_[a-z0-9_]{8,48}$/i

function normalizeOrigin(value: string) {
  try {
    return new URL(value).origin
  } catch {
    return ''
  }
}

function getAllowedOrigins() {
  const origins = new Set<string>()

  const configuredOrigin = normalizeOrigin(paymentConfig.siteUrl)
  if (configuredOrigin) {
    origins.add(configuredOrigin)
  }

  origins.add('http://localhost:3000')
  origins.add('http://127.0.0.1:3000')

  // Dev-only escape hatch — local network testing (other devices on
  // the same LAN) + tunnels (cloudflared / ngrok) need an opt-in list
  // of extra origins. Hard-gated behind NODE_ENV !== 'production': in
  // prod we ignore the env var even if it leaks into the runtime, so
  // an accidental .env entry on the VPS cannot widen the trusted set.
  if (process.env.NODE_ENV !== 'production') {
    const extra = process.env.DEV_EXTRA_ALLOWED_ORIGINS ?? ''
    for (const raw of extra.split(',')) {
      const normalised = normalizeOrigin(raw.trim())
      if (normalised) origins.add(normalised)
    }
  }

  return origins
}

// Codex 2026-05-07 #4b — closed.
//
// Was: `getClientIp` read the FIRST hop of `X-Forwarded-For`. The first
// hop is whatever the client sent — `X-Forwarded-For: 1.2.3.4` makes us
// see `1.2.3.4` regardless of the real socket IP. Per-IP rate limits
// (`auth:login:ip`, `webhook:cloudpayments:*`, etc.) became per-XFF-value,
// so an attacker rotating the header bypassed every per-IP bucket.
//
// Now: trust ONLY `X-Real-IP`. Production nginx config sets
// `proxy_set_header X-Real-IP $remote_addr` — `$remote_addr` is the
// socket IP that nginx itself sees, NOT a client header, and
// `proxy_set_header` always OVERWRITES whatever the client sent. So
// `X-Real-IP` arrives at Node bound to the actual TCP-connected
// address. We deliberately do NOT trust `X-Forwarded-For` because
// nginx's `$proxy_add_x_forwarded_for` APPENDS to (does not overwrite)
// whatever the client sent — the first hop is still attacker-supplied.
//
// `cf-connecting-ip` is kept as a secondary because if a future
// deployment puts Cloudflare in front, CF's header is the trust anchor.
// Today there is no CF in front of levelchannel.ru.
//
// Local dev: no nginx, so `X-Real-IP` is unset → returns `unknown`.
// That's fine — rate-limit buckets keyed by `unknown` clamp local
// abuse to a single bucket, which is the desired behaviour.
//
// F5 (security-audit-2026-06-02 Sub-PR 3) — observability layer.
// In production, an `X-Real-IP`-absent request signals an nginx config
// drift: every IP-keyed rate-limit bucket collapses into a single
// `'unknown'` shared bucket (DoS amplifier). We emit a structured
// `console.warn` so the operator picks it up via journald. Throttled
// to one log line per `REAL_IP_WARN_WINDOW_MS` window to avoid
// flooding. Return value is unchanged — pure observability.

const REAL_IP_WARN_WINDOW_MS = 60_000
let lastRealIpMissingWarnAt = 0

function warnIfRealIpMissingInProd(request: Request) {
  if (process.env.NODE_ENV !== 'production') {
    return
  }
  // X-Real-IP present → nothing to flag (that's the nginx happy path).
  // X-Real-IP absent but cf-connecting-ip present → STILL warn: the
  // current prod has no Cloudflare in front, so a request that lands
  // with only cf-connecting-ip and no X-Real-IP also signals nginx
  // drift. If/when a real CF edge is fronted, revisit this branch
  // (then cf-connecting-ip alone becomes the new trusted anchor and
  // shouldn't fire the warn). The companion test pins this contract:
  // tests/security/get-client-ip-warn.test.ts §"warns even when only
  // cf-connecting-ip is present".
  if (request.headers.get('x-real-ip')) {
    return
  }
  const now = Date.now()
  if (now - lastRealIpMissingWarnAt < REAL_IP_WARN_WINDOW_MS) {
    return
  }
  lastRealIpMissingWarnAt = now
  // Structured JSON so journald + log shipper can parse. Tag with a
  // grep-able prefix matching the project convention (see proxy.ts
  // `[proxy/csp]`).
  console.warn(
    JSON.stringify({
      tag: '[security/getClientIp]',
      event: 'x_real_ip_missing',
      message:
        'X-Real-IP header absent in production; per-IP rate-limit buckets ' +
        'collapse to the shared "unknown" key. Check nginx proxy_set_header ' +
        'X-Real-IP $remote_addr in the levelchannel.ru server block.',
      hasCfConnectingIp: Boolean(request.headers.get('cf-connecting-ip')),
      throttleWindowMs: REAL_IP_WARN_WINDOW_MS,
    }),
  )
}

export function getClientIp(request: Request) {
  warnIfRealIpMissingInProd(request)
  return (
    request.headers.get('x-real-ip') ||
    request.headers.get('cf-connecting-ip') ||
    'unknown'
  )
}

// Test-only: reset the warn throttle so each test starts from a
// deterministic state. Not exported for prod callers — the throttle
// is intentionally process-lifetime in production.
export function __resetGetClientIpWarnThrottleForTests() {
  lastRealIpMissingWarnAt = 0
}

export async function enforceRateLimit(
  request: Request,
  scope: string,
  limit: number,
  windowMs: number,
) {
  const ip = getClientIp(request)
  const result = await takeRateLimit(`${scope}:${ip}`, limit, windowMs)

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

export function enforceTrustedBrowserOrigin(request: Request) {
  const origin = request.headers.get('origin')
  const secFetchSite = request.headers.get('sec-fetch-site')

  if (
    secFetchSite &&
    secFetchSite !== 'same-origin' &&
    secFetchSite !== 'same-site' &&
    secFetchSite !== 'none'
  ) {
    return NextResponse.json(
      { error: 'Cross-site requests are not allowed.' },
      { status: 403, headers: { 'Cache-Control': 'no-store, max-age=0' } },
    )
  }

  if (!origin) {
    return null
  }

  const allowedOrigins = getAllowedOrigins()

  if (!allowedOrigins.has(normalizeOrigin(origin))) {
    return NextResponse.json(
      { error: 'Untrusted request origin.' },
      { status: 403, headers: { 'Cache-Control': 'no-store, max-age=0' } },
    )
  }

  return null
}

export function isValidInvoiceId(invoiceId: string) {
  return INVOICE_ID_PATTERN.test(invoiceId)
}
