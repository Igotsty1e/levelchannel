/** @type {import('next').NextConfig} */
const { withSentryConfig } = require('@sentry/nextjs')

// Sentry's browser SDK posts events to the EU ingest endpoint we got
// from Sentry-side project keys. CSP must allow connect-src to
// `*.ingest.de.sentry.io` or every event from a real user is blocked.
const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self' https://t.me https://*.t.me",
  "script-src 'self' 'unsafe-inline' https://widget.cloudpayments.ru https://www.googletagmanager.com https://www.google-analytics.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: https://*.cloudpayments.ru",
  "connect-src 'self' https://api.cloudpayments.ru https://widget.cloudpayments.ru https://*.cloudpayments.ru https://www.google-analytics.com https://region1.google-analytics.com https://*.ingest.de.sentry.io https://*.ingest.sentry.io",
  "frame-src 'self' https://widget.cloudpayments.ru https://*.cloudpayments.ru",
  "worker-src 'self' blob:",
].join('; ')

const nextConfig = {
  // Server-ready build. Payment webhooks and order creation require a running Node.js app.
  images: {
    // Required for static export (no server-side image optimization)
    unoptimized: true,
  },

  // Security headers — active only when running `next start` (VPS/Node.js mode).
  // For Apache shared hosting these are set in public/.htaccess instead.
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'Content-Security-Policy', value: contentSecurityPolicy },
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains; preload' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-XSS-Protection', value: '1; mode=block' },
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
  disableLogger: true,
  // Source maps upload only when SENTRY_AUTH_TOKEN is set in env.
  // Local builds and the autodeploy script (currently without the
  // token) just ship the SDK with bundled stack traces; readable
  // enough for v1.
})
