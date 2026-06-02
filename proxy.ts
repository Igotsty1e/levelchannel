import * as Sentry from '@sentry/nextjs'
import { type NextRequest, NextResponse } from 'next/server'

import { assembleCsp, generateNonce } from '@/lib/security/csp'

// Wave 11 PR 1.1 — per-request CSP nonce, on the Next.js 16 `proxy.ts`
// file convention (renamed from `middleware.ts`; export name is `proxy`).
// Functional contract is unchanged from PR 1; only the file name +
// exported function name move per Next.js 16 deprecation of the
// `middleware` convention.
//
// Why we renamed: PR 1 verified live on prod that the proxy was
// running and setting CSP per request, but Next.js 16 was NOT auto-
// stamping `nonce` on framework-emitted RSC payload `<script>` blocks.
// Hypothesis under test in PR 1.1 — auto-stamping may only be wired
// to the new `proxy` convention. If true, the rename unblocks PR 3.
// If not, this commit is a forward-compat clean-up regardless.
//
// Runs on every browser-facing request (the matcher excludes API routes,
// static assets, and Next-internal asset paths). Generates a fresh
// 128-bit nonce per request, threads it into:
//
//   - the request headers via `x-nonce`, so route handlers / Server
//     Components can read it via `headers().get('x-nonce')` if they
//     need to stamp it onto a manual `<script nonce={...}>`.
//   - the response Content-Security-Policy header, so the browser
//     enforces which inline scripts to trust.
//
// CSP source-of-truth: `lib/security/csp.ts`. Static security headers
// (HSTS, X-Frame-Options, etc.) stay in `next.config.js`.
//
// Cost: ~1 ms per browser request. Path matcher excludes static assets.

export function proxy(request: NextRequest) {
  // Codex review 2026-05-09 — this file is on the request path for
  // every browser-facing request. A future regression in
  // `assembleCsp` or `generateNonce` would otherwise turn into a
  // site-wide 500. Wrap the CSP setup in try/catch and degrade to a
  // no-CSP-set response on internal failure — the request still
  // reaches the app, the static security headers from
  // `next.config.js` (HSTS, X-Frame-Options, etc.) still apply, and
  // the operator finds the failure in the journal instead of users
  // finding it in the form of a white page.
  //
  // Failure mode IS visible: console.error tag `[proxy/csp]` so
  // grep'ing journalctl turns it up; we don't try to retry or
  // fail-soft beyond logging.
  try {
    const nonce = generateNonce()
    const csp = assembleCsp({ nonce })

    // Mirror the nonce into the *request* headers so Next.js App
    // Router sees it. Reading `headers().get('x-nonce')` in
    // `app/layout.tsx` is the trigger that activates Next.js's
    // auto-stamping of `nonce=` on framework-emitted inline scripts.
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
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(
      `[proxy/csp] fallback to no-CSP — ${msg}; ` +
        `request will continue without per-request CSP. ` +
        `Static security headers from next.config.js still apply.`,
    )
    // F6 (security-audit-2026-06-02 Sub-PR 3) — surface the CSP
    // fallback to Sentry so the operator sees it without tailing
    // journald. Wrapped in try/catch so a Sentry failure can't take
    // down the proxy itself. The `surface` tag lets Sentry alerts key
    // off csp-fallback specifically.
    try {
      Sentry.captureException(err, { tags: { surface: 'csp-fallback' } })
    } catch {
      // Sentry init may not have run on this edge instance, or the
      // SDK may have its own internal error. Either way, do not
      // re-throw from the catch — the console.error above is the
      // operator's backstop.
    }
    // No CSP header on fallback path. The browser falls back to its
    // default-permissive behavior; static next.config.js headers
    // (HSTS, X-Frame-Options, X-Content-Type-Options, etc.) still
    // apply. Better than a 500 on every request.
    return NextResponse.next()
  }
}

// Matcher excludes:
//   - /api/* — API routes don't render HTML, no inline scripts to gate
//   - /_next/static, /_next/image — framework assets
//   - common static asset extensions — same reason
//   - Next.js internal `/_next/*` non-static paths get the proxy
//     because they include things like RSC fetches (text/x-component)
//     where a CSP doesn't hurt
//
// `missing` excludes prefetch requests (the browser prefetching a route
// shouldn't burn a unique nonce that would never be used).
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
