import Link from 'next/link'

import type { ResearchPostSummary } from '@/lib/research/types'

import './research-tokens.css'

function formatDateRu(iso?: string): string {
  if (!iso) return ''
  const dt = new Date(iso)
  if (Number.isNaN(dt.getTime())) return iso
  const months = [
    'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
    'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
  ]
  return `${dt.getDate()} ${months[dt.getMonth()]} ${dt.getFullYear()}`
}

export function ResearchIndex({ posts }: { posts: ResearchPostSummary[] }) {
  return (
    <main className="research-article">
      <div className="rs-container">
        <section className="rs-index-hero">
          <span className="rs-index-eyebrow">Level Channel · Research</span>
          <h1 className="rs-index-title">Публичные цифры о EdTech и ИИ в обучении</h1>
          <p className="rs-index-lede">
            Раз в месяц мы собираем рынок частного и онлайн-обучения по открытым источникам:
            рейтинги, отчёты компаний, опросы, регуляторные публикации. Каждая цифра проверена
            независимо — без маркетинговых пресс-релизов и анонимных аналитиков.
          </p>
        </section>

        {posts.length === 0 ? (
          <div className="rs-index-empty">
            <p>Скоро здесь появится первая публикация.</p>
          </div>
        ) : (
          <div className="rs-index-grid">
            {posts.map((p) => (
              <Link key={p.slug} href={`/research/${p.slug}`} className="rs-index-card">
                {p.about && p.about.length > 0 ? (
                  <div className="rs-index-card-tags">
                    {p.about.slice(0, 3).map((tag) => (
                      <span key={tag} className="rs-index-card-tag">
                        {tag}
                      </span>
                    ))}
                  </div>
                ) : null}
                <h2 className="rs-index-card-title">{p.title}</h2>
                <p className="rs-index-card-lede">{p.description}</p>
                <div className="rs-index-card-meta">
                  {formatDateRu(p.publishedAt)}
                  {p.readingTimeMinutes ? ` · ${p.readingTimeMinutes} мин чтения` : ''}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
