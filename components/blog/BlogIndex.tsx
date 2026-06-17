import Link from 'next/link'

import { BrandMarkAnimated } from '@/components/brand/brand-mark-animated'
import type { BlogPostSummary } from '@/lib/blog/types'

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

export function BlogIndex({ posts }: { posts: BlogPostSummary[] }) {
  return (
    <main className="blog-article">
      <div className="bl-index-frame">
        <nav className="bl-crumbs" aria-label="Хлебные крошки">
          <Link href="/">Главная</Link>
          <span className="sep">/</span>
          <Link href="/blog">Журнал</Link>
        </nav>

        <header className="bl-index-hero">
          <Link href="/" className="bl-brand" aria-label="Level Channel — на главную">
            <BrandMarkAnimated width={148} />
          </Link>
          <span className="bl-index-eyebrow">Level Channel · Журнал</span>
          <h1 className="bl-index-title">Заметки основателя</h1>
          <p className="bl-index-lede">
            Короткие заметки о том, как устроен продукт, чем живёт рынок частного
            репетиторства и почему мы делаем кабинет именно так. Без жёсткого графика.
          </p>
        </header>

        {posts.length === 0 ? (
          <div className="bl-index-empty">Скоро здесь появится первая заметка.</div>
        ) : (
          <div className="bl-index-list">
            {posts.map((p, i) => {
              const num = String(i + 1).padStart(2, '0')
              return (
                <Link key={p.slug} href={`/blog/${p.slug}`} className="bl-index-card">
                  <div className="bl-index-card-num">№ {num}</div>
                  <div className="bl-index-card-body">
                    {p.tags && p.tags.length > 0 ? (
                      <div className="bl-index-card-tags">
                        {p.tags.slice(0, 3).map((tag) => (
                          <span key={tag}>{tag}</span>
                        ))}
                      </div>
                    ) : null}
                    <h2 className="bl-index-card-title">{p.title}</h2>
                    <p className="bl-index-card-lede">{p.lede}</p>
                  </div>
                  <div className="bl-index-card-meta">
                    {formatDateRu(p.publishedAt)}
                    {p.readingTimeMinutes ? (
                      <>
                        <br />
                        {p.readingTimeMinutes} мин чтения
                      </>
                    ) : null}
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </main>
  )
}
