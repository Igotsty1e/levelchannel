// Single source of truth for the Content-Security-Policy assembled per
// request. Wave 11 PR 1 — see docs/plans/csp-hardening.md.
//
// PR 1 ships the *machinery* (middleware + this template) without
// changing the actual policy yet — `'unsafe-inline'` is still present on
// `script-src` and `style-src` so nothing breaks. PR 3 drops it from
// `script-src` (browser then trusts only nonce'd inline scripts). PR 4
// splits `style-src` so `style-src-attr 'unsafe-inline'` keeps inline
// `style={...}` JSX attributes working without a mass CSS-Modules
// refactor.
//
// Why a per-request nonce. Next.js App Router emits inline `<script>`
// blocks during SSR for hydration / RSC payload / route prefetch hints.
// We can't externalise those — they embed per-render server values. The
// fix is a per-request random nonce that the framework auto-stamps onto
// every inline script it generates; the browser then refuses any inline
// script whose nonce doesn't match the response header. Injected
// scripts (XSS) won't carry the nonce → blocked.
//
// Why this lives in lib/ and not next.config.js. CSP must be derived
// from a per-request value (the nonce). next.config.js's headers() runs
// once per build for static rules. Middleware reads + sets headers per
// request; the policy template lives here so unit tests can verify it
// independent of Edge runtime quirks.

export type CspOptions = {
  nonce: string
}

// Assemble the policy string. Whitespace is collapsed before set so the
// returned value is one logical line per browser convention.
export function assembleCsp({ nonce }: CspOptions): string {
  const directives = [
    `default-src 'self'`,
    `base-uri 'self'`,
    `object-src 'none'`,
    `frame-ancestors 'none'`,
    `form-action 'self' https://t.me https://*.t.me`,
    // PR 3 will drop `'unsafe-inline'` from this directive. Until then,
    // both `'unsafe-inline'` AND the nonce are listed — when both are
    // present, browsers honour `'unsafe-inline'` and the nonce is a
    // no-op. So this is functionally identical to today's policy; the
    // nonce just isn't load-bearing yet.
    `script-src 'self' 'unsafe-inline' 'nonce-${nonce}' https://widget.cloudpayments.ru https://www.googletagmanager.com https://www.google-analytics.com`,
    // Same reasoning — nonce listed but not load-bearing yet. PR 4
    // splits this into `style-src` (no `'unsafe-inline'`) +
    // `style-src-attr 'unsafe-inline'` for inline `style={...}` attrs.
    `style-src 'self' 'unsafe-inline' 'nonce-${nonce}' https://fonts.googleapis.com`,
    `font-src 'self' https://fonts.gstatic.com`,
    `img-src 'self' data: https://*.cloudpayments.ru`,
    `connect-src 'self' https://api.cloudpayments.ru https://widget.cloudpayments.ru https://*.cloudpayments.ru https://www.google-analytics.com https://region1.google-analytics.com https://*.ingest.de.sentry.io https://*.ingest.sentry.io`,
    `frame-src 'self' https://widget.cloudpayments.ru https://*.cloudpayments.ru`,
    `worker-src 'self' blob:`,
  ]

  return directives.join('; ')
}

// Generate a 128-bit base64 nonce. Edge Runtime exposes `crypto` (Web
// Crypto API) but NOT Node's `crypto.randomBytes`. `crypto.randomUUID()`
// is available on both Node 20 and Edge Runtime; base64-encoding gives
// us a fixed-width nonce that survives URL contexts (we only put it in
// headers, but defensive). Output is 24 chars: 22 base64 + 2 padding.
export function generateNonce(): string {
  return btoa(crypto.randomUUID())
}
