import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { ResearchArticle } from '@/components/research/ResearchArticle'
import {
  listResearchSlugs,
  loadResearchPost,
} from '@/lib/research/load-post'

type Params = { slug: string }

export async function generateStaticParams(): Promise<Params[]> {
  const slugs = await listResearchSlugs()
  return slugs.map((slug) => ({ slug }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>
}): Promise<Metadata> {
  const { slug } = await params
  const post = await loadResearchPost(slug)
  if (!post) {
    return {
      title: 'Research — не найдено',
    }
  }
  const { seo } = post
  return {
    title: seo.title,
    description: seo.description,
    keywords: seo.keywords,
    alternates: { canonical: `/research/${slug}` },
    openGraph: {
      title: seo.title,
      description: seo.description,
      type: 'article',
      locale: seo.locale ?? 'ru_RU',
      url: seo.canonical_url,
      siteName: seo.publisher?.name ?? 'Level Channel',
      images: seo.og_image_url
        ? [
            {
              url: seo.og_image_url,
              width: 1200,
              height: 630,
              alt: seo.og_image_alt ?? seo.title,
            },
          ]
        : [`/research/${slug}/opengraph-image`],
      publishedTime: seo.published_at,
      modifiedTime: seo.modified_at,
      authors: seo.author?.name ? [seo.author.name] : undefined,
    },
    twitter: {
      card: 'summary_large_image',
      title: seo.title,
      description: seo.description,
      images: seo.og_image_url
        ? [seo.og_image_url]
        : [`/research/${slug}/opengraph-image`],
    },
    authors: seo.author?.name
      ? [{ name: seo.author.name, url: seo.author.url }]
      : undefined,
  }
}

export default async function ResearchPostPage({
  params,
}: {
  params: Promise<Params>
}) {
  const { slug } = await params
  const post = await loadResearchPost(slug)
  if (!post) notFound()
  return <ResearchArticle post={post} />
}
