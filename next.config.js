/** @type {import('next').NextConfig} */
const { withSentryConfig } = require('@sentry/nextjs')

// Wave 11 PR 1 — Content-Security-Policy moved out of this file into
// `middleware.ts` so it can carry a per-request nonce. Source of truth:
// `lib/security/csp.ts`. Other static security headers (HSTS, X-Frame-
// Options, X-Content-Type-Options, etc.) stay here — they don't depend
// on per-request state.
//
// See `docs/plans/csp-hardening.md` for the rollout sequence.

const nextConfig = {
  // Server-ready build. Payment webhooks and order creation require a running Node.js app.
  images: {
    // Required for static export (no server-side image optimization)
    unoptimized: true,
  },

  // Dev-only: allow the LAN IP and any cloudflared quick-tunnel host so
  // we can poke the dev server from a phone. Production builds ignore
  // `allowedDevOrigins`. Format = bare hostnames (no scheme, no port).
  allowedDevOrigins: [
    '192.168.6.31',
    '*.trycloudflare.com',
  ],

  // Codex 2026-05-08 (LOW) — strip the `X-Powered-By: Next.js` header.
  // Drives down server-fingerprinting surface; bots that match
  // version-specific Next.js exploits won't see the banner.
  poweredByHeader: false,

  // Security headers — active only when running `next start` (VPS/Node.js mode).
  // For Apache shared hosting these are set in public/.htaccess instead.
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          // Content-Security-Policy moved to middleware.ts (per-request nonce).
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains; preload' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          // X-XSS-Protection removed 2026-05-10 — modern browsers
          // ignore it (Chrome dropped it in M78, Firefox never had it,
          // Safari followed). The CSP header (set in middleware) is
          // the actual defense; X-XSS-Protection just adds noise.
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
          { key: 'X-DNS-Prefetch-Control', value: 'off' },
        ],
      },
    ]
  },
}

// withSentryConfig:
// - injects source-maps upload (silent if SENTRY_AUTH_TOKEN missing,
//   which is the case in dev / on-prem builds without the token)
// - tunnels client SDK requests through /monitoring to bypass adblockers
//   that strip *.sentry.io connect-src (we still allow direct ingest in
//   CSP above for fallback)
// - hides Source Map upload errors from breaking the build
module.exports = withSentryConfig(nextConfig, {
  org: 'mastery-zs',
  project: 'levelchannel',
  silent: !process.env.CI,
  // No tunnelRoute — middleware/edge route would need its own setup.
  // Direct ingest via CSP allowance is fine for our audience.
  webpack: { treeshake: { removeDebugLogging: true } },
  // Source maps upload only when SENTRY_AUTH_TOKEN is set in env.
  // Local builds and the autodeploy script (currently without the
  // token) just ship the SDK with bundled stack traces; readable
  // enough for v1.
})
