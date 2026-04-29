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

export function getClientIp(request: Request) {
  const forwardedFor = request.headers.get('x-forwarded-for')
  if (forwardedFor) {
    return forwardedFor.split(',')[0]?.trim() || 'unknown'
  }

  return (
    request.headers.get('x-real-ip') ||
    request.headers.get('cf-connecting-ip') ||
    'unknown'
  )
}

export function enforceRateLimit(
  request: Request,
  scope: string,
  limit: number,
  windowMs: number,
) {
  const ip = getClientIp(request)
  const result = takeRateLimit(`${scope}:${ip}`, limit, windowMs)

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
