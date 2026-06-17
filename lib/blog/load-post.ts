import { promises as fs } from 'node:fs'
import path from 'node:path'

import type { BlogPost, BlogPostSummary } from './types'

/**
 * Server-only filesystem reader for founder journal posts.
 *
 * Posts live in /content/blog/<slug>/post.json. Все поля собраны
 * в один файл — пост короткий, разделять на structured.json /
 * seo.json (как в /research/) избыточно.
 *
 * Reads are wrapped in node fs to keep them strictly server-side.
 */

const CONTENT_DIR = path.join(process.cwd(), 'content', 'blog')

async function readJson<T>(p: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(p, 'utf-8')
    return JSON.parse(raw) as T
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

export async function loadBlogPost(slug: string): Promise<BlogPost | null> {
  const dir = path.join(CONTENT_DIR, slug)
  const post = await readJson<BlogPost>(path.join(dir, 'post.json'))
  if (!post) return null
  return { ...post, slug }
}

export async function listBlogPosts(): Promise<BlogPostSummary[]> {
  let entries: string[] = []
  try {
    entries = await fs.readdir(CONTENT_DIR)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
  const summaries: BlogPostSummary[] = []
  for (const slug of entries) {
    const post = await readJson<BlogPost>(path.join(CONTENT_DIR, slug, 'post.json'))
    if (!post) continue
    summaries.push({
      slug,
      title: post.title,
      lede: post.lede,
      publishedAt: post.published_at ?? '',
      modifiedAt: post.modified_at,
      readingTimeMinutes: post.reading_time_minutes,
      tags: post.tags,
    })
  }
  // newest first
  summaries.sort((a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || ''))
  return summaries
}

export async function listBlogSlugs(): Promise<string[]> {
  try {
    const entries = await fs.readdir(CONTENT_DIR, { withFileTypes: true })
    return entries.filter((e) => e.isDirectory()).map((e) => e.name)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
}
