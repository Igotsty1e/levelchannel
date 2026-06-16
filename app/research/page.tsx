import type { Metadata } from 'next'

import { ResearchIndex } from '@/components/research/ResearchIndex'
import { listResearchPosts } from '@/lib/research/load-post'

export const metadata: Metadata = {
  title: 'Research — независимые обзоры рынков по открытым данным | LevelChannel',
  description:
    'Level Channel Research — небольшое исследовательское агентство. Обзоры рынков по открытым данным: рейтинги, отчёты, опросы, регуляторика. Каждая цифра проверена независимо.',
  alternates: { canonical: '/research' },
  openGraph: {
    title: 'Level Channel Research',
    description:
      'Независимое исследовательское агентство. Обзоры рынков по открытым данным — без маркетинговых пресс-релизов и заказных интеграций.',
    type: 'website',
    locale: 'ru_RU',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Level Channel Research',
    description:
      'Независимое исследовательское агентство. Обзоры рынков по открытым данным — без маркетинговых пресс-релизов и заказных интеграций.',
  },
}

export default async function ResearchIndexPage() {
  const posts = await listResearchPosts()
  return <ResearchIndex posts={posts} />
}
