import type { Metadata } from 'next'

import { BlogIndex } from '@/components/blog/BlogIndex'
import { listBlogPosts } from '@/lib/blog/load-post'

export const metadata: Metadata = {
  title: 'Журнал — заметки основателя Level Channel',
  description:
    'Заметки основателя Level Channel о рынке частного репетиторства, продуктовых решениях кабинета и философии «почему мы делаем именно так».',
  alternates: { canonical: '/blog' },
  openGraph: {
    title: 'Level Channel — Журнал',
    description:
      'Заметки основателя о рынке частного репетиторства и продуктовых решениях.',
    type: 'website',
    locale: 'ru_RU',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Level Channel — Журнал',
    description:
      'Заметки основателя о рынке частного репетиторства и продуктовых решениях.',
  },
}

export default async function BlogIndexPage() {
  const posts = await listBlogPosts()
  return <BlogIndex posts={posts} />
}
