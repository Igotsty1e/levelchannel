import { promises as fs } from 'node:fs'
import path from 'node:path'

import type {
  Figure,
  ResearchPost,
  ResearchPostSummary,
  Seo,
  SourceRow,
  Structured,
  VisualSystem,
} from './types'

/**
 * Server-only filesystem reader for research posts.
 *
 * Posts live in /content/research/<slug>/ with these files:
 *   structured.json     — required, hero + sections
 *   seo.json            — required, page metadata + tldr + faq
 *   figures.json        — optional, chart specs
 *   visual-system.json  — optional, section accents + hero composition
 *   sources.jsonl       — optional, audited source list
 *
 * Reads are wrapped in node fs to keep them strictly server-side.
 * Throws on missing required files; tolerates missing optional ones.
 */

const CONTENT_DIR = path.join(process.cwd(), 'content', 'research')

async function readJson<T>(p: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(p, 'utf-8')
    return JSON.parse(raw) as T
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

async function readJsonl<T>(p: string): Promise<T[]> {
  try {
    const raw = await fs.readFile(p, 'utf-8')
    return raw
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line) as T)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
}

export async function loadResearchPost(slug: string): Promise<ResearchPost | null> {
  const dir = path.join(CONTENT_DIR, slug)
  const structured = await readJson<Structured>(path.join(dir, 'structured.json'))
  const seo = await readJson<Seo>(path.join(dir, 'seo.json'))
  if (!structured || !seo) return null
  const figuresFile = await readJson<{ figures?: Record<string, Figure> }>(
    path.join(dir, 'figures.json'),
  )
  const visualSystem =
    (await readJson<VisualSystem>(path.join(dir, 'visual-system.json'))) ?? {}
  const sources = await readJsonl<SourceRow>(path.join(dir, 'sources.jsonl'))
  return {
    slug,
    structured,
    seo,
    figures: figuresFile?.figures ?? {},
    visualSystem,
    sources,
  }
}

export async function listResearchPosts(): Promise<ResearchPostSummary[]> {
  let entries: string[] = []
  try {
    entries = await fs.readdir(CONTENT_DIR)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
  const summaries: ResearchPostSummary[] = []
  for (const slug of entries) {
    const seo = await readJson<Seo>(path.join(CONTENT_DIR, slug, 'seo.json'))
    if (!seo) continue
    summaries.push({
      slug,
      title: seo.title,
      description: seo.description,
      publishedAt: seo.published_at ?? '',
      modifiedAt: seo.modified_at,
      readingTimeMinutes: seo.reading_time_minutes,
      about: seo.about,
      ogImageUrl: seo.og_image_url,
    })
  }
  // newest first
  summaries.sort((a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || ''))
  return summaries
}

export async function listResearchSlugs(): Promise<string[]> {
  try {
    const entries = await fs.readdir(CONTENT_DIR, { withFileTypes: true })
    return entries.filter((e) => e.isDirectory()).map((e) => e.name)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
}
