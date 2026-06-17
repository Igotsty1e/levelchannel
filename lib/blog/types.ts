/**
 * Type contract for founder journal posts (`/blog`).
 *
 * Простой формат для коротких editorial-эссе: один JSON-файл на
 * пост, body_html пишется вручную. Никаких figures, sources или
 * матрёшки — это блог, не research.
 */

export type BlogAuthor = {
  name: string
  role?: string
  url?: string
}

export type BlogSection = {
  id: string
  /** null → секция без заголовка (например, вступительный абзац) */
  h2: string | null
  body_html: string
}

export type BlogFAQItem = { q: string; a: string }

export type BlogPost = {
  slug: string
  title: string
  lede: string
  description: string
  published_at: string
  modified_at?: string
  reading_time_minutes: number
  author: BlogAuthor
  tags?: string[]
  og_image_alt?: string
  keywords?: string[]
  sections: BlogSection[]
  faq?: BlogFAQItem[]
}

export type BlogPostSummary = {
  slug: string
  title: string
  lede: string
  publishedAt: string
  modifiedAt?: string
  readingTimeMinutes: number
  tags?: string[]
}
