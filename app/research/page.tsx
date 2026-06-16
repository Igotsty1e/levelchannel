import type { Metadata } from 'next'

import { ResearchIndex } from '@/components/research/ResearchIndex'
import { listResearchPosts } from '@/lib/research/load-post'

export const metadata: Metadata = {
  title: 'Research — публичные цифры о EdTech и ИИ в обучении | LevelChannel',
  description:
    'Ежемесячный обзор рынка частного и онлайн-обучения. Только открытые источники, каждая цифра проверена независимо.',
  alternates: { canonical: '/research' },
  openGraph: {
    title: 'Level Channel Research',
    description:
      'Независимые обзоры рынка EdTech и применения ИИ в обучении — только публичные данные.',
    type: 'website',
    locale: 'ru_RU',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Level Channel Research',
    description:
      'Независимые обзоры рынка EdTech и применения ИИ в обучении — только публичные данные.',
  },
}

export default async function ResearchIndexPage() {
  const posts = await listResearchPosts()
  return <ResearchIndex posts={posts} />
}
