/**
 * Type contract for research posts, mirrors the data shape produced
 * by the levelchannel-research pipeline (structured.json + figures.json
 * + visual-system.json + seo.json).
 *
 * The renderer consumes whatever fields are present; unknown fields
 * are tolerated for forward-compat with future pipeline waves.
 */

export type StatCard = {
  label: string
  value: string
  trend?: string
  footnote?: string
  accent?: AccentName
}

export type Section = {
  id: string
  title: string
  icon?: string
  layer_1_html: string
  layer_2_html: string
  layer_3_html: string
}

export type Hero = {
  title: string
  lede: string
  meta: string
  cards: StatCard[]
}

export type Structured = {
  hero: Hero
  sections: Section[]
}

export type FigureKind =
  | 'hbar'
  | 'columns'
  | 'donut'
  | 'timeline'
  | 'sparkline'
  | 'metric-strip'
  | 'compare-pies'
  | 'pull-quote'

export type FigureBarItem = { label: string; value: number; highlight?: boolean }
export type FigureColumnItem = FigureBarItem
export type FigureCompareItem = { label: string; percent: number }
export type FigureTimelineItem = { date: string; event: string; kind?: 'fact' | 'hypothesis' }
export type FigureMetricItem = {
  value: string
  label: string
  trend?: string
  sparkline?: number[]
}
export type FigurePullQuoteData = { text: string; attribution?: string }

export type Figure = {
  section_id?: string
  kind: FigureKind
  accent?: AccentName
  unit?: string
  title?: string
  data: unknown
}

export type FiguresFile = {
  figures: Record<string, Figure>
}

export type VisualSystem = {
  hero?: {
    kind?: 'stat-grid' | 'infographic'
    composition?: {
      headline?: string
      metrics?: Array<{ value: string; label: string; trend?: string }>
    }
  }
  section_accents?: Record<string, AccentName>
}

export type Author = {
  name: string
  url?: string
  bio?: string
}

export type Publisher = {
  name: string
  url?: string
  logo_url?: string
}

export type FAQItem = { q: string; a: string }

export type Seo = {
  title: string
  description: string
  keywords?: string[]
  slug: string
  canonical_url: string
  locale?: string
  published_at?: string
  modified_at?: string
  reading_time_minutes?: number
  author?: Author
  publisher?: Publisher
  og_image_url?: string
  og_image_alt?: string
  about?: string[]
  mentions?: string[]
  tldr?: string[]
  faq?: FAQItem[]
}

export type SourceRow = {
  id: string
  title: string
  url: string
  quality_tier?: 'A' | 'B' | 'C' | 'D'
  publisher_org?: string
  published_at?: string
}

export type AccentName =
  | 'rose'
  | 'coral'
  | 'peach'
  | 'warm-amber'
  | 'info'
  | 'success'
  | 'warning'
  | 'danger'

export type ResearchPost = {
  slug: string
  structured: Structured
  figures: Record<string, Figure>
  visualSystem: VisualSystem
  seo: Seo
  sources: SourceRow[]
}

export type ResearchPostSummary = {
  slug: string
  title: string
  description: string
  publishedAt: string
  modifiedAt?: string
  readingTimeMinutes?: number
  about?: string[]
  ogImageUrl?: string
}
