import type { MetadataRoute } from 'next'

const BASE = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') || 'https://levelchannel.ru'

export default function robots(): MetadataRoute.Robots {
  // SEO 2026-06-09 §4.8 — drop non-standard `host` (Yandex-only).
  // Add explicit Allow for /integrations/ which is implicitly allowed
  // but explicit-allow is safer if we ever add a sub-route.
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/', '/integrations/'],
        disallow: [
          '/api/',
          '/admin/',
          '/_next/',
          '/cabinet/',
          '/teacher/',
          '/login',
          '/register/confirm',
          '/reset',
          '/thank-you',
          '/checkout/',
        ],
      },
    ],
    sitemap: `${BASE}/sitemap.xml`,
  }
}
