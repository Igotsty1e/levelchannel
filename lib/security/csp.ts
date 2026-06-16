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
    // PR 3 (2026-05-09) — `'unsafe-inline'` dropped. With PR 1.2 the
    // layout reads `headers().get('x-nonce')`, which puts every page
    // into dynamic-render mode and activates Next.js's auto-stamping
    // of `nonce=` on framework-emitted `<script>` blocks (RSC
    // hydration payloads + Next bootstrap). Verified live on prod
    // post PR #99: all 5 inline scripts on `/` carry the response
    // nonce; CloudPayments + Sentry external scripts also stamped.
    // The browser now refuses any inline script lacking the nonce.
    //
    // GA / GTM allowlist entries kept per Open Question #1 (decision
    // deferred 2026-05-08); will be dropped once GA wiring intent is
    // resolved.
    `script-src 'self' 'nonce-${nonce}' https://widget.cloudpayments.ru https://www.googletagmanager.com https://www.google-analytics.com https://mc.yandex.ru`,
    // PR 4 — split: `style-src` originally dropped `'unsafe-inline'`
    // because empirically there were 0 inline `<style>` blocks. PR
    // 2026-06-09 (landing-v3 promote) added 6 `<style>{...}</style>`
    // blocks in landing-v3 screens for @media queries + :hover states.
    // Re-add `'unsafe-inline'` temporarily; DEBT to extract those
    // blocks into landing-v3.css (external, covered by `'self'`) and
    // drop `'unsafe-inline'` again.
    // `fonts.googleapis.com` / `fonts.gstatic.com` removed because
    // `next/font/google` self-hosts the font files since Next 13+.
    `style-src 'self' 'unsafe-inline'`,
    `style-src-attr 'unsafe-inline'`,
    `font-src 'self'`,
    `img-src 'self' data: https://*.cloudpayments.ru https://mc.yandex.ru`,
    `connect-src 'self' https://api.cloudpayments.ru https://widget.cloudpayments.ru https://*.cloudpayments.ru https://www.google-analytics.com https://region1.google-analytics.com https://*.ingest.de.sentry.io https://*.ingest.sentry.io https://mc.yandex.ru`,
    `frame-src 'self' https://widget.cloudpayments.ru https://*.cloudpayments.ru https://mc.yandex.ru`,
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
