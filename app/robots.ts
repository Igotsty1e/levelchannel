import type { MetadataRoute } from 'next'

const BASE = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') || 'https://levelchannel.ru'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/'],
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
    host: BASE,
  }
}
