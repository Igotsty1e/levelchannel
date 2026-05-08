import { type NextRequest, NextResponse } from 'next/server'

import { assembleCsp, generateNonce } from '@/lib/security/csp'

// Wave 11 PR 1 — per-request CSP nonce.
//
// Runs on every browser-facing request (the matcher excludes API routes,
// static assets, and Next-internal asset paths). Generates a fresh
// 128-bit nonce per request, threads it into:
//
//   - the request headers via `x-nonce`, so route handlers / Server
//     Components can read it via `headers().get('x-nonce')` if they need
//     to stamp it onto a manual `<script nonce={...}>`. Next.js App
//     Router auto-stamps the nonce onto its own framework-generated
//     inline scripts when it sees the request header.
//   - the response Content-Security-Policy header, so the browser knows
//     which inline scripts to trust.
//
// Why we set CSP here instead of in next.config.js: CSP needs the
// per-request nonce. next.config.js's headers() runs once per build and
// can only emit static values. The static security headers (HSTS,
// X-Frame-Options, etc.) stay in next.config.js. Only the CSP moves.
//
// Cost: middleware runs on every browser request, adding ~1 ms for nonce
// generation + header assembly. Acceptable for a low-QPS site. Path
// matcher excludes static assets so we don't do this work for every PNG.

export function middleware(request: NextRequest) {
  const nonce = generateNonce()
  const csp = assembleCsp({ nonce })

  // Mirror the nonce into the *request* headers so Next.js App Router
  // sees it and auto-stamps it onto framework-generated inline scripts.
  // This is the documented integration point per the Next.js CSP guide.
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-nonce', nonce)
  requestHeaders.set('Content-Security-Policy', csp)

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  })

  // Set the response CSP header so the *browser* enforces it.
  response.headers.set('Content-Security-Policy', csp)

  return response
}

// Matcher excludes:
//   - /api/* — API routes don't render HTML, no inline scripts to gate
//   - /_next/static, /_next/image — framework assets
//   - common static asset extensions — same reason
//   - Next.js internal `/_next/*` non-static paths get the middleware
//     because they include things like RSC fetches (text/x-component)
//     where a CSP doesn't hurt
//
// `missing` excludes prefetch requests (the browser prefetching a route
// shouldn't burn a unique nonce that would never be used). Per the
// Next.js CSP integration guide.
export const config = {
  matcher: [
    {
      source:
        '/((?!api|_next/static|_next/image|favicon.ico|.*\\.png$|.*\\.svg$|.*\\.jpg$|.*\\.jpeg$|.*\\.gif$|.*\\.webp$|.*\\.ico$).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
}
