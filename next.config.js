/** @type {import('next').NextConfig} */
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
  "connect-src 'self' https://api.cloudpayments.ru https://widget.cloudpayments.ru https://*.cloudpayments.ru https://www.google-analytics.com https://region1.google-analytics.com",
  "frame-src 'self' https://widget.cloudpayments.ru https://*.cloudpayments.ru",
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

module.exports = nextConfig
