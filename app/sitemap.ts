import type { MetadataRoute } from 'next'

const BASE = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') || 'https://levelchannel.ru'

/**
 * SEO 2026-06-09 §4.2 — sitemap covers only canonical, indexable,
 * content-bearing URLs. Legal/auth pages dropped (low SEO value,
 * confuses Search Console "Items unparsable" counters).
 *
 * `lastModified` is a const per route — set to the last meaningful
 * content edit (manually maintained). Bumping to `new Date()` on every
 * crawl was lying to Google about freshness; pinned dates surface
 * real edits.
 */
const PAGES: ReadonlyArray<{
  path: string
  priority: number
  changeFreq: MetadataRoute.Sitemap[number]['changeFrequency']
  lastModified: string // YYYY-MM-DD
}> = [
  { path: '/', priority: 1.0, changeFreq: 'weekly', lastModified: '2026-06-09' },
  { path: '/anastasiia', priority: 0.5, changeFreq: 'monthly', lastModified: '2026-06-07' },
  { path: '/integrations/google-calendar', priority: 0.7, changeFreq: 'monthly', lastModified: '2026-06-09' },
  { path: '/saas/learn/cabinet', priority: 0.85, changeFreq: 'monthly', lastModified: '2026-05-22' },
  { path: '/saas/learn/crm-for-tutors', priority: 0.85, changeFreq: 'monthly', lastModified: '2026-05-22' },
  { path: '/saas/learn/schedule', priority: 0.85, changeFreq: 'monthly', lastModified: '2026-05-22' },
  { path: '/saas/learn/students', priority: 0.85, changeFreq: 'monthly', lastModified: '2026-05-22' },
  { path: '/saas/learn/sbp', priority: 0.85, changeFreq: 'monthly', lastModified: '2026-05-22' },
  { path: '/saas/learn/packages', priority: 0.8, changeFreq: 'monthly', lastModified: '2026-05-22' },
  { path: '/saas/learn/notifications', priority: 0.8, changeFreq: 'monthly', lastModified: '2026-05-22' },
  { path: '/saas/learn/multiplatform', priority: 0.8, changeFreq: 'monthly', lastModified: '2026-05-22' },
  { path: '/saas/learn/security', priority: 0.8, changeFreq: 'monthly', lastModified: '2026-05-22' },
  { path: '/saas/learn/free', priority: 0.8, changeFreq: 'monthly', lastModified: '2026-05-31' },
]

export default function sitemap(): MetadataRoute.Sitemap {
  return PAGES.map(({ path, priority, changeFreq, lastModified }) => ({
    url: `${BASE}${path}`,
    lastModified: new Date(lastModified),
    changeFrequency: changeFreq,
    priority,
  }))
}
