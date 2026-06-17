import Link from 'next/link'

import { BrandMarkAnimated } from '@/components/brand/brand-mark-animated'
import type { Figure, ResearchPost, SourceRow } from '@/lib/research/types'

import './research-tokens.css'

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

function ByTheNumbersStrip({
  cards,
}: {
  cards: ResearchPost['structured']['hero']['cards']
}) {
  if (!cards.length) return null
  return (
    <section className="rs-bynumbers" aria-label="Главные цифры">
      {cards.slice(0, 4).map((c, i) => (
        <div key={`${c.label}-${i}`} className="col">
          <div className="label">{c.label}</div>
          <div className="value">{c.value}</div>
          {c.trend ? <div className="trend">{c.trend}</div> : null}
          {c.footnote ? <div className="foot">{c.footnote}</div> : null}
        </div>
      ))}
    </section>
  )
}

export function ResearchArticle({ post }: { post: ResearchPost }) {
  const { seo, structured, figures, visualSystem, sources } = post
  const jsonLdBlocks = buildJsonLd(post)
  const shareUrl = seo.canonical_url || ''
  const shareText = seo.title || ''
  const enc = encodeURIComponent

  // Group figures by section_id for inline placement.
  const figsBySection: Record<string, Array<[string, Figure]>> = {}
  for (const [fid, fig] of Object.entries(figures)) {
    const sid = fig.section_id
    if (!sid) continue
    if (!figsBySection[sid]) figsBySection[sid] = []
    figsBySection[sid].push([fid, fig])
  }
  const sectionAccents = visualSystem.section_accents ?? {}
  const tldr = seo.tldr ?? []

  return (
    <article className="research-article">
      {jsonLdBlocks.map((block, i) => (
        <script
          key={i}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(block) }}
        />
      ))}
      <div className="rs-frame">
        <nav className="rs-crumbs" aria-label="Хлебные крошки">
          <Link href="/">Главная</Link>
          <span className="sep">/</span>
          <Link href="/research">Research</Link>
        </nav>

        <header className="rs-masthead">
          <Link href="/" className="rs-brand" aria-label="Level Channel — на главную">
            <BrandMarkAnimated width={148} />
          </Link>
          <div className="rs-kicker">Research</div>
          <h1 className="rs-h1">{structured.hero.title}</h1>
          <p className="rs-lede">{structured.hero.lede}</p>
          <div className="rs-byline">
            {seo.author?.name ? (
              <span>
                <strong>{seo.author.name}</strong>
              </span>
            ) : null}
            {seo.published_at ? (
              <>
                <span className="dot">·</span>
                <span>{formatDateRu(seo.published_at)}</span>
              </>
            ) : null}
            {seo.reading_time_minutes ? (
              <>
                <span className="dot">·</span>
                <span>{seo.reading_time_minutes} мин чтения</span>
              </>
            ) : null}
            {structured.hero.meta ? (
              <>
                <span className="dot">·</span>
                <span>{structured.hero.meta}</span>
              </>
            ) : null}
          </div>
        </header>

        <ByTheNumbersStrip cards={structured.hero.cards} />

        <details className="rs-toc-inline" aria-label="Содержание">
          <summary>
            <span className="rs-toc-label-left">
              <span className="rs-toc-sign">+</span>
              <span>Содержание</span>
            </span>
            <span className="rs-toc-count">
              {structured.sections.length} разд
              {structured.sections.length === 1 ? 'ел' : 'елов'}
            </span>
          </summary>
          <div className="rs-toc-body">
            <ol>
              {structured.sections.map((s) => (
                <li key={s.id}>
                  <a href={`#${s.id}`}>{s.title}</a>
                </li>
              ))}
            </ol>
          </div>
        </details>

        <main className="rs-body">
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

          {structured.sections.map((s, i) => (
            <ResearchSection
              key={s.id}
              section={s}
              index={i + 1}
              accent={sectionAccents[s.id] ?? 'rose'}
              figures={figsBySection[s.id] ?? []}
            />
          ))}

            <footer className="rs-article-footer">
              <div className="rs-author">
                <div className="rs-author-mark">Автор</div>
                <div className="rs-author-body">
                  <div className="rs-author-name">
                    {seo.author?.name ?? 'Редакция Level Channel'}
                  </div>
                  {seo.author?.bio ? (
                    <div className="rs-author-bio">{seo.author.bio}</div>
                  ) : null}
                  <div className="rs-author-dates">
                    {seo.published_at ? `Опубликовано ${formatDateRu(seo.published_at)}` : ''}
                    {seo.modified_at && seo.modified_at !== seo.published_at
                      ? ` · обновлено ${formatDateRu(seo.modified_at)}`
                      : ''}
                  </div>
                </div>
              </div>

              <div className="rs-cta">
                <div className="rs-cta-text">
                  <strong>Ежемесячный research-дайджест.</strong> Без спама, отписка в один клик.
                </div>
                <Link href="/research#subscribe" className="rs-cta-link">
                  Подписаться →
                </Link>
              </div>

              <div className="rs-share">
                <span className="rs-share-label">Поделиться</span>
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
                <a
                  href={`https://www.threads.net/intent/post?text=${enc(shareText + ' ' + shareUrl)}`}
                  rel="noopener"
                  target="_blank"
                >
                  Threads
                </a>
                <a
                  href={`https://www.facebook.com/sharer/sharer.php?u=${enc(shareUrl)}`}
                  rel="noopener"
                  target="_blank"
                >
                  Facebook
                </a>
              </div>

              {sources.length > 0 ? (
                <section className="rs-sources" aria-label="Источники">
                  <h3 className="rs-sources-h">Источники</h3>
                  <ol>
                    {sources
                      .filter((s) => s.url && s.title)
                      .map((s) => (
                        <li key={s.id}>
                          <a href={s.url} rel="noopener" target="_blank">
                            {s.title}
                          </a>
                          {humanSourceKind(s.quality_tier) ? (
                            <span className="kind">— {humanSourceKind(s.quality_tier)}</span>
                          ) : null}
                        </li>
                      ))}
                  </ol>
                </section>
              ) : null}

              <div className="rs-disclaimer">
                Все цифры — открытые источники: отраслевые рейтинги, отчёты компаний, опросы
                пользователей. Каждое утверждение проверено независимо; методика опубликована и
                доступна по запросу. Это редакционный материал, не реклама. Бренды упоминаются для
                иллюстрации, без коммерческих интеграций.
              </div>
            </footer>
        </main>
      </div>
    </article>
  )
}
