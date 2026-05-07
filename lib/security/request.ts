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
export function getClientIp(request: Request) {
  return (
    request.headers.get('x-real-ip') ||
    request.headers.get('cf-connecting-ip') ||
    'unknown'
  )
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
