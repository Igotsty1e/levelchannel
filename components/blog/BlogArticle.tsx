import Link from 'next/link'

import { BrandMarkAnimated } from '@/components/brand/brand-mark-animated'
import type { BlogPost, BlogPostSummary } from '@/lib/blog/types'

import './blog-tokens.css'

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

function buildJsonLd(post: BlogPost): object[] {
  const canonical = `https://levelchannel.ru/blog/${post.slug}`
  const article: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: post.title.slice(0, 110),
    description: post.description,
    mainEntityOfPage: canonical,
    datePublished: post.published_at,
    dateModified: post.modified_at ?? post.published_at,
    author: {
      '@type': 'Person',
      name: post.author.name,
      url: post.author.url ? `https://levelchannel.ru${post.author.url}` : undefined,
    },
    publisher: {
      '@type': 'Organization',
      name: 'Level Channel',
      url: 'https://levelchannel.ru',
      logo: {
        '@type': 'ImageObject',
        url: 'https://levelchannel.ru/favicon.svg',
      },
    },
  }
  const breadcrumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Главная', item: 'https://levelchannel.ru/' },
      {
        '@type': 'ListItem',
        position: 2,
        name: 'Журнал',
        item: 'https://levelchannel.ru/blog',
      },
      { '@type': 'ListItem', position: 3, name: post.title, item: canonical },
    ],
  }
  const out: object[] = [article, breadcrumb]
  if (post.faq?.length) {
    out.push({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: post.faq.map((q) => ({
        '@type': 'Question',
        name: q.q,
        acceptedAnswer: { '@type': 'Answer', text: q.a },
      })),
    })
  }
  return out
}

export function BlogArticle({
  post,
  related,
}: {
  post: BlogPost
  related: BlogPostSummary[]
}) {
  const canonical = `https://levelchannel.ru/blog/${post.slug}`
  const shareText = post.title
  const enc = encodeURIComponent
  const jsonLdBlocks = buildJsonLd(post)

  return (
    <article className="blog-article">
      {jsonLdBlocks.map((block, i) => (
        <script
          key={i}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(block) }}
        />
      ))}
      <div className="bl-frame">
        <nav className="bl-crumbs" aria-label="Хлебные крошки">
          <Link href="/">Главная</Link>
          <span className="sep">/</span>
          <Link href="/blog">Журнал</Link>
        </nav>

        <header className="bl-masthead">
          <Link href="/" className="bl-brand" aria-label="Level Channel — на главную">
            <BrandMarkAnimated width={132} />
          </Link>
          <div className="bl-kicker">Журнал</div>
          <h1 className="bl-h1">{post.title}</h1>
          <p className="bl-lede">{post.lede}</p>
          <div className="bl-byline">
            <span>
              <strong>{post.author.name}</strong>
              {post.author.role ? `, ${post.author.role}` : ''}
            </span>
            {post.published_at ? (
              <>
                <span className="dot">·</span>
                <span>{formatDateRu(post.published_at)}</span>
              </>
            ) : null}
            {post.reading_time_minutes ? (
              <>
                <span className="dot">·</span>
                <span>{post.reading_time_minutes} мин чтения</span>
              </>
            ) : null}
            {post.tags?.length ? (
              <>
                <span className="dot">·</span>
                {post.tags.map((t) => (
                  <span key={t} className="bl-tag">
                    {t}
                  </span>
                ))}
              </>
            ) : null}
          </div>
        </header>

        <main className="bl-body">
          {post.sections.map((s) => (
            <section key={s.id} id={s.id} className="bl-section">
              {s.h2 ? <h2 className="bl-h2">{s.h2}</h2> : null}
              <div
                className="bl-prose"
                dangerouslySetInnerHTML={{ __html: s.body_html }}
              />
            </section>
          ))}
        </main>

        <footer className="bl-article-footer">
          <div className="bl-author">
            <div className="bl-author-mark">Автор</div>
            <div className="bl-author-body">
              <div className="bl-author-name">{post.author.name}</div>
              {post.author.role ? (
                <div className="bl-author-role">{post.author.role}</div>
              ) : null}
              {post.author.url ? (
                <Link href={post.author.url} className="bl-author-link">
                  О Level Channel →
                </Link>
              ) : null}
            </div>
          </div>

          <div className="bl-cta">
            <div className="bl-cta-text">
              <strong>Получать новые заметки.</strong> Раз в месяц — то, что
              опубликовано в журнале и обзорах. Без спама.
            </div>
            <Link href="/research#subscribe" className="bl-cta-link">
              Подписаться →
            </Link>
          </div>

          <div className="bl-share">
            <span className="bl-share-label">Поделиться</span>
            <a
              href={`https://t.me/share/url?url=${enc(canonical)}&text=${enc(shareText)}`}
              rel="noopener"
              target="_blank"
            >
              Telegram
            </a>
            <a
              href={`https://twitter.com/intent/tweet?url=${enc(canonical)}&text=${enc(shareText)}`}
              rel="noopener"
              target="_blank"
            >
              X
            </a>
            <a
              href={`https://www.linkedin.com/sharing/share-offsite/?url=${enc(canonical)}`}
              rel="noopener"
              target="_blank"
            >
              LinkedIn
            </a>
            <a
              href={`https://www.threads.net/intent/post?text=${enc(shareText + ' ' + canonical)}`}
              rel="noopener"
              target="_blank"
            >
              Threads
            </a>
            <a
              href={`https://www.facebook.com/sharer/sharer.php?u=${enc(canonical)}`}
              rel="noopener"
              target="_blank"
            >
              Facebook
            </a>
            <a
              href={`https://vk.com/share.php?url=${enc(canonical)}`}
              rel="noopener"
              target="_blank"
            >
              VK
            </a>
          </div>

          {related.length > 0 ? (
            <section className="bl-related" aria-label="Связанные заметки">
              <h3 className="bl-related-h">Ещё в журнале</h3>
              <ul>
                {related.map((r) => (
                  <li key={r.slug}>
                    <Link href={`/blog/${r.slug}`}>
                      {r.title}
                      <span className="meta">
                        {formatDateRu(r.publishedAt)}
                        {r.readingTimeMinutes
                          ? ` · ${r.readingTimeMinutes} мин чтения`
                          : ''}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <div className="bl-disclaimer">
            Заметки в журнале — частное мнение автора, не формальная
            позиция компании. Уточнения и обратная связь —{' '}
            <a href="mailto:hello@levelchannel.ru">hello@levelchannel.ru</a>.
          </div>
        </footer>
      </div>
    </article>
  )
}
