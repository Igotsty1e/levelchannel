import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { BlogArticle } from '@/components/blog/BlogArticle'
import {
  listBlogPosts,
  listBlogSlugs,
  loadBlogPost,
} from '@/lib/blog/load-post'

type Params = { slug: string }

export async function generateStaticParams(): Promise<Params[]> {
  const slugs = await listBlogSlugs()
  return slugs.map((slug) => ({ slug }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>
}): Promise<Metadata> {
  const { slug } = await params
  const post = await loadBlogPost(slug)
  if (!post) {
    return { title: 'Журнал — заметка не найдена' }
  }
  return {
    title: `${post.title} — Журнал Level Channel`,
    description: post.description,
    keywords: post.keywords,
    alternates: { canonical: `/blog/${slug}` },
    openGraph: {
      title: post.title,
      description: post.description,
      type: 'article',
      locale: 'ru_RU',
      url: `https://levelchannel.ru/blog/${slug}`,
      siteName: 'Level Channel',
      images: [`/blog/${slug}/opengraph-image`],
      publishedTime: post.published_at,
      modifiedTime: post.modified_at,
      authors: post.author?.name ? [post.author.name] : undefined,
    },
    twitter: {
      card: 'summary_large_image',
      title: post.title,
      description: post.description,
      images: [`/blog/${slug}/opengraph-image`],
    },
    authors: post.author?.name
      ? [{ name: post.author.name, url: post.author.url }]
      : undefined,
  }
}

export default async function BlogPostPage({
  params,
}: {
  params: Promise<Params>
}) {
  const { slug } = await params
  const post = await loadBlogPost(slug)
  if (!post) notFound()
  const allPosts = await listBlogPosts()
  const related = allPosts.filter((p) => p.slug !== slug).slice(0, 3)
  return <BlogArticle post={post} related={related} />
}
