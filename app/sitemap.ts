import type { MetadataRoute } from 'next'

import { listResearchPosts } from '@/lib/research/load-post'

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
 *
 * /research/* entries are discovered at build time by reading the
 * content/research/ directory (see lib/research/load-post.ts).
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
  { path: '/research', priority: 0.9, changeFreq: 'weekly', lastModified: '2026-06-16' },
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

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticEntries = PAGES.map(({ path, priority, changeFreq, lastModified }) => ({
    url: `${BASE}${path}`,
    lastModified: new Date(lastModified),
    changeFrequency: changeFreq,
    priority,
  }))
  const researchPosts = await listResearchPosts()
  const researchEntries: MetadataRoute.Sitemap = researchPosts.map((p) => ({
    url: `${BASE}/research/${p.slug}`,
    lastModified: p.modifiedAt
      ? new Date(p.modifiedAt)
      : p.publishedAt
        ? new Date(p.publishedAt)
        : new Date(),
    changeFrequency: 'monthly',
    priority: 0.85,
  }))
  return [...staticEntries, ...researchEntries]
}
