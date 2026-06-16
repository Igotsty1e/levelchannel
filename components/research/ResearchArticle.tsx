import Link from 'next/link'

import type { Figure, ResearchPost, SourceRow } from '@/lib/research/types'

import './research-tokens.css'

import { ResearchFigure } from './ResearchFigure'
import { ResearchSection } from './ResearchSection'

const RU_MONTHS = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
]

function formatDateRu(iso?: string): string {
  if (!iso) return ''
  const dt = new Date(iso)
  if (Number.isNaN(dt.getTime())) return iso
  return `${dt.getDate()} ${RU_MONTHS[dt.getMonth()]} ${dt.getFullYear()}`
}

function humanSourceKind(tier?: SourceRow['quality_tier']): string {
  switch (tier) {
    case 'A':
      return 'первоисточник'
    case 'B':
      return 'отраслевой обзор'
    case 'C':
      return 'социальный сигнал'
    case 'D':
      return 'вторичная оценка'
    default:
      return ''
  }
}

function authorInitials(name?: string): string {
  if (!name) return 'LC'
  const words = name.split(/\s+/).filter(Boolean).slice(0, 2)
  return words.map((w) => w[0]?.toUpperCase() ?? '').join('') || 'LC'
}

function buildJsonLd(post: ResearchPost): object[] {
  const { seo, structured } = post
  const canonical = seo.canonical_url
  const article: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: (seo.title || structured.hero.title || '').slice(0, 110),
    description: seo.description,
    mainEntityOfPage: canonical,
  }
  if (seo.published_at) article.datePublished = seo.published_at
  if (seo.modified_at) article.dateModified = seo.modified_at
  if (seo.author?.name) {
    article.author = { '@type': 'Organization', name: seo.author.name, url: seo.author.url }
  }
  if (seo.publisher?.name) {
    article.publisher = {
      '@type': 'Organization',
      name: seo.publisher.name,
      url: seo.publisher.url,
      logo: seo.publisher.logo_url
        ? { '@type': 'ImageObject', url: seo.publisher.logo_url }
        : undefined,
    }
  }
  if (seo.og_image_url) article.image = seo.og_image_url
  if (seo.about?.length)
    article.about = seo.about.map((name) => ({ '@type': 'Thing', name }))
  if (seo.mentions?.length)
    article.mentions = seo.mentions.map((name) => ({ '@type': 'Thing', name }))

  const breadcrumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Главная', item: 'https://levelchannel.ru/' },
      {
        '@type': 'ListItem',
        position: 2,
        name: 'Research',
        item: 'https://levelchannel.ru/research',
      },
      { '@type': 'ListItem', position: 3, name: seo.title, item: canonical },
    ],
  }

  const out: object[] = [article, breadcrumb]
  if (seo.faq?.length) {
    out.push({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: seo.faq.map((q) => ({
        '@type': 'Question',
        name: q.q,
        acceptedAnswer: { '@type': 'Answer', text: q.a },
      })),
    })
  }
  return out
}

function HeroStatGrid({
  cards,
}: {
  cards: ResearchPost['structured']['hero']['cards']
}) {
  if (!cards.length) return null
  return (
    <section className="rs-hero-stats" aria-label="Главные цифры">
      {cards.map((c, i) => (
        <div className="rs-stat-card" key={`${c.label}-${i}`} data-accent={c.accent ?? 'rose'}>
          <div className="rs-stat-label">{c.label}</div>
          <div className="rs-stat-value">{c.value}</div>
          {c.trend ? <div className="rs-stat-trend">{c.trend}</div> : null}
          {c.footnote ? <div className="rs-stat-foot">{c.footnote}</div> : null}
        </div>
      ))}
    </section>
  )
}

function HeroInfographic({ composition }: { composition: NonNullable<ResearchPost['visualSystem']['hero']>['composition'] }) {
  if (!composition) return null
  return (
    <section
      className="rs-hero-stats"
      aria-label="Главные цифры"
      style={{ display: 'block', padding: '28px 28px 24px', border: '1px solid var(--v4-rule)', borderRadius: 16, background: 'var(--rs-surface-1)' }}
    >
      {composition.headline ? (
        <div
          style={{
            fontSize: 13,
            letterSpacing: '0.08em',
            color: 'var(--v4-text-muted)',
            marginBottom: 18,
            textTransform: 'uppercase',
          }}
        >
          {composition.headline}
        </div>
      ) : null}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 16,
        }}
      >
        {(composition.metrics ?? []).map((m, i) => (
          <div key={`${m.label}-${i}`}>
            <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--v4-text-primary)', fontFeatureSettings: '"tnum" on' }}>
              {m.value}
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--v4-text-muted)', marginTop: 4 }}>{m.label}</div>
            {m.trend ? (
              <div style={{ fontSize: 12.5, color: 'var(--v4-accent-end)', marginTop: 4 }}>{m.trend}</div>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  )
}

export function ResearchArticle({ post }: { post: ResearchPost }) {
  const { seo, structured, figures, visualSystem, sources } = post
  const sectionAccents = visualSystem.section_accents ?? {}
  const heroKind = visualSystem.hero?.kind ?? 'stat-grid'

  // Group figures by section_id
  const figsBySection: Record<string, Array<[string, Figure]>> = {}
  for (const [fid, fig] of Object.entries(figures)) {
    const sid = fig.section_id
    if (!sid) continue
    if (!figsBySection[sid]) figsBySection[sid] = []
    figsBySection[sid].push([fid, fig])
  }

  const tldr = seo.tldr ?? []
  const jsonLdBlocks = buildJsonLd(post)
  const shareUrl = seo.canonical_url || ''
  const shareText = seo.title || ''
  const enc = encodeURIComponent

  return (
    <article className="research-article">
      {jsonLdBlocks.map((block, i) => (
        <script
          key={i}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(block) }}
        />
      ))}
      <div className="rs-container">
        <nav aria-label="Хлебные крошки" style={{ fontSize: 12.5, color: 'var(--v4-text-muted)', marginBottom: 12 }}>
          <Link href="/" style={{ color: 'inherit', textDecoration: 'none' }}>Главная</Link>
          <span style={{ margin: '0 8px' }}>›</span>
          <Link href="/research" style={{ color: 'inherit', textDecoration: 'none' }}>Research</Link>
        </nav>

        <header className="rs-masthead">
          <div className="rs-badge">Level Channel · Research</div>
          <h1 className="rs-h1">{structured.hero.title}</h1>
          <p className="rs-lede">{structured.hero.lede}</p>
          <div className="rs-meta">{structured.hero.meta}</div>
        </header>

        {tldr.length > 0 ? (
          <aside className="rs-tldr" aria-label="Кратко">
            <div className="rs-tldr-label">Кратко</div>
            <ul>
              {tldr.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
          </aside>
        ) : null}

        <nav className="rs-toc" aria-label="Содержание">
          <span className="rs-toc-label">Содержание</span>
          <ol>
            {structured.sections.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`}>{s.title}</a>
              </li>
            ))}
          </ol>
        </nav>

        {heroKind === 'infographic' && visualSystem.hero?.composition ? (
          <HeroInfographic composition={visualSystem.hero.composition} />
        ) : (
          <HeroStatGrid cards={structured.hero.cards} />
        )}

        {structured.sections.map((s) => (
          <ResearchSection
            key={s.id}
            section={s}
            accent={sectionAccents[s.id] ?? 'rose'}
            figures={figsBySection[s.id] ?? []}
          />
        ))}

        <footer className="rs-article-footer">
          <div className="rs-author-block">
            <div className="rs-author-avatar" aria-hidden>
              {authorInitials(seo.author?.name)}
            </div>
            <div>
              <div className="rs-author-name">{seo.author?.name ?? 'Редакция Level Channel'}</div>
              {seo.author?.bio ? (
                <div className="rs-author-bio">{seo.author.bio}</div>
              ) : null}
              <div className="rs-author-dates">
                {seo.published_at ? `опубликовано ${formatDateRu(seo.published_at)}` : ''}
                {seo.modified_at && seo.modified_at !== seo.published_at
                  ? ` · обновлено ${formatDateRu(seo.modified_at)}`
                  : ''}
                {seo.reading_time_minutes ? ` · ${seo.reading_time_minutes} мин чтения` : ''}
              </div>
            </div>
          </div>

          <div className="rs-cta-strip">
            <div className="rs-cta-h">Получать новые исследования первыми</div>
            <div className="rs-cta-sub">
              Один раз в месяц — обзор рынка EdTech и применения ИИ в обучении. Без спама, отписка в один клик.
            </div>
            <div className="rs-cta-row">
              <Link href="/research#subscribe" className="rs-cta-btn">
                Подписаться на дайджест
              </Link>
              <Link href="/" className="rs-cta-btn ghost">
                О Level Channel
              </Link>
            </div>
          </div>

          <div className="rs-share-strip">
            <span className="rs-share-label">Поделиться:</span>
            <a
              href={`https://t.me/share/url?url=${enc(shareUrl)}&text=${enc(shareText)}`}
              rel="noopener"
              target="_blank"
            >
              Telegram
            </a>
            <a
              href={`https://twitter.com/intent/tweet?url=${enc(shareUrl)}&text=${enc(shareText)}`}
              rel="noopener"
              target="_blank"
            >
              X
            </a>
            <a
              href={`https://www.linkedin.com/sharing/share-offsite/?url=${enc(shareUrl)}`}
              rel="noopener"
              target="_blank"
            >
              LinkedIn
            </a>
            <a
              href={`https://vk.com/share.php?url=${enc(shareUrl)}`}
              rel="noopener"
              target="_blank"
            >
              VK
            </a>
          </div>

          {sources.length > 0 ? (
            <section className="rs-sources-block" aria-label="Источники">
              <h3>Источники</h3>
              <ul>
                {sources
                  .filter((s) => s.url && s.title)
                  .map((s) => (
                    <li key={s.id}>
                      <a href={s.url} rel="noopener" target="_blank">
                        {s.title}
                      </a>
                      {humanSourceKind(s.quality_tier) ? ` — ${humanSourceKind(s.quality_tier)}` : ''}
                    </li>
                  ))}
              </ul>
            </section>
          ) : null}

          <div className="rs-disclaimer">
            Все цифры — открытые источники: отраслевые рейтинги, отчёты компаний, опросы пользователей.
            Каждое утверждение проверено независимо; методика опубликована и доступна по запросу. Это
            редакционный материал, не реклама. Бренды упоминаются для иллюстрации, без коммерческих
            интеграций.
          </div>
        </footer>
      </div>
    </article>
  )
}
