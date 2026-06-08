import type { MetadataRoute } from 'next'

const BASE = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') || 'https://levelchannel.ru'

const STATIC_PATHS: { path: string; priority?: number; changeFreq?: MetadataRoute.Sitemap[number]['changeFrequency'] }[] = [
  { path: '/', priority: 1.0, changeFreq: 'weekly' },
  { path: '/anastasiia', priority: 0.5, changeFreq: 'monthly' },
  { path: '/saas/learn/cabinet', priority: 0.85, changeFreq: 'monthly' },
  { path: '/saas/learn/crm-for-tutors', priority: 0.85, changeFreq: 'monthly' },
  { path: '/saas/learn/schedule', priority: 0.85, changeFreq: 'monthly' },
  { path: '/saas/learn/students', priority: 0.85, changeFreq: 'monthly' },
  { path: '/saas/learn/sbp', priority: 0.85, changeFreq: 'monthly' },
  { path: '/saas/learn/packages', priority: 0.8, changeFreq: 'monthly' },
  { path: '/saas/learn/notifications', priority: 0.8, changeFreq: 'monthly' },
  { path: '/saas/learn/multiplatform', priority: 0.8, changeFreq: 'monthly' },
  { path: '/saas/learn/security', priority: 0.8, changeFreq: 'monthly' },
  { path: '/saas/learn/free', priority: 0.8, changeFreq: 'monthly' },
  { path: '/saas/offer', priority: 0.3, changeFreq: 'yearly' },
  { path: '/saas/processor-terms', priority: 0.3, changeFreq: 'yearly' },
  { path: '/privacy', priority: 0.3, changeFreq: 'yearly' },
  { path: '/consent/personal-data', priority: 0.3, changeFreq: 'yearly' },
  { path: '/login', priority: 0.4, changeFreq: 'yearly' },
  { path: '/register', priority: 0.6, changeFreq: 'yearly' },
]

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date()
  return STATIC_PATHS.map(({ path, priority, changeFreq }) => ({
    url: `${BASE}${path}`,
    lastModified: now,
    changeFrequency: changeFreq,
    priority,
  }))
}
