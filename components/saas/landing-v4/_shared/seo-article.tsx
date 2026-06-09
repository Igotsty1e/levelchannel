'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { motion } from 'framer-motion'
import type { ReactNode } from 'react'

import { BackgroundBeams } from '@/components/ui/aceternity/background-beams'
import { track } from '@/lib/analytics/track'

const reveal = {
  initial: { opacity: 0, y: 24 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: '-80px' },
}

export type SeoSection = {
  id: string
  h2: string
  body: ReactNode
}

export function SeoArticle({
  eyebrow,
  h1,
  lede,
  sections,
  faq,
  ctaHref = '/register?role=teacher&utm_source=landing-v4-seo&utm_content=article',
  ctaText = 'Открыть кабинет',
}: {
  eyebrow: string
  h1: ReactNode
  lede: ReactNode
  sections: SeoSection[]
  faq?: Array<{ q: string; a: string }>
  ctaHref?: string
  ctaText?: string
}) {
  const pathname = usePathname()
  const slug = (pathname ?? '').replace(/^\/saas\/learn\//, '').replace(/\/$/, '').slice(0, 64) || 'unknown'
  const softwareSchema = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'LevelChannel',
    applicationCategory: 'BusinessApplication',
    applicationSubCategory: 'CRM',
    operatingSystem: 'Web Browser',
    url: 'https://levelchannel.ru/',
    description:
      'CRM для частного репетитора: расписание, ученики, балансы, СБП и месячный отчёт. Стартовый тариф навсегда бесплатный.',
    offers: [
      {
        '@type': 'Offer',
        name: 'Стартовый',
        price: '0',
        priceCurrency: 'RUB',
        description: 'Один ученик. Все функции. Навсегда бесплатно.',
      },
      {
        '@type': 'Offer',
        name: 'Базовый',
        price: '300',
        priceCurrency: 'RUB',
        description: 'До 5 учеников. Подписка через CloudPayments.',
      },
      {
        '@type': 'Offer',
        name: 'Расширенный',
        price: '800',
        priceCurrency: 'RUB',
        description: 'До 30 учеников. Подписка через CloudPayments.',
      },
    ],
    publisher: {
      '@type': 'Organization',
      name: 'LevelChannel',
      url: 'https://levelchannel.ru/',
    },
  }

  const faqSchema =
    faq && faq.length > 0
      ? {
          '@context': 'https://schema.org',
          '@type': 'FAQPage',
          mainEntity: faq.map((item) => ({
            '@type': 'Question',
            name: item.q,
            acceptedAnswer: {
              '@type': 'Answer',
              text: item.a,
            },
          })),
        }
      : null

  return (
    <article className="v4-seo-article">
      {/* SoftwareApplication structured data — для всех SEO-страниц */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareSchema) }}
      />
      {faqSchema ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
        />
      ) : null}
      <section className="v4-scene v4-scene--short" id="seo-hero">
        <div className="v4-scene__bg">
          <BackgroundBeams />
        </div>
        <div className="v4-scene__content" style={{ maxWidth: 880, textAlign: 'center' }}>
          <motion.div {...reveal} transition={{ duration: 0.7 }} className="v4-eyebrow" style={{ marginBottom: 24 }}>
            {eyebrow}
          </motion.div>
          <motion.h1 {...reveal} transition={{ duration: 0.9, delay: 0.1 }} className="v4-h1 v4-h1--serif" style={{ fontSize: 'clamp(32px, 5.2vw, 64px)' }}>
            {h1}
          </motion.h1>
          <motion.p {...reveal} transition={{ duration: 0.9, delay: 0.2 }} className="v4-lede" style={{ marginTop: 28, marginInline: 'auto' }}>
            {lede}
          </motion.p>
        </div>
      </section>

      <section style={{ padding: 'clamp(40px, 8vh, 80px) clamp(24px, 4vw, 80px)' }}>
        <div style={{ maxWidth: 720, marginInline: 'auto', display: 'grid', gap: 56 }}>
          {sections.map((s) => (
            <motion.div
              key={s.id}
              {...reveal}
              transition={{ duration: 0.7 }}
              id={s.id}
              style={{ scrollMarginTop: 120 }}
            >
              <h2 className="v4-h2 v4-h2--serif" style={{ marginBottom: 20, fontSize: 'clamp(24px, 3.4vw, 36px)' }}>
                {s.h2}
              </h2>
              <div className="v4-prose">{s.body}</div>
            </motion.div>
          ))}
        </div>
      </section>

      {faq && faq.length > 0 ? (
        <section
          style={{
            padding: 'clamp(40px, 8vh, 80px) clamp(24px, 4vw, 80px)',
            background: 'var(--v4-surface)',
            borderTop: '1px solid var(--v4-rule)',
          }}
        >
          <div style={{ maxWidth: 720, marginInline: 'auto' }}>
            <motion.div {...reveal} transition={{ duration: 0.7 }} className="v4-eyebrow" style={{ marginBottom: 20 }}>
              Часто спрашивают
            </motion.div>
            <h2 className="v4-h2 v4-h2--serif" style={{ marginBottom: 36, fontSize: 'clamp(24px, 3.4vw, 36px)' }}>
              Вопросы
            </h2>
            <div style={{ display: 'grid', gap: 16 }}>
              {faq.map((item) => (
                <details
                  key={item.q}
                  className="v4-card"
                  style={{ padding: 0, overflow: 'hidden' }}
                >
                  <summary
                    style={{
                      padding: '20px 24px',
                      cursor: 'pointer',
                      listStyle: 'none',
                      fontSize: 16,
                      fontWeight: 600,
                      color: 'var(--v4-text-primary)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 16,
                    }}
                  >
                    <span>{item.q}</span>
                    <span style={{ color: 'var(--v4-text-muted)' }}>+</span>
                  </summary>
                  <div
                    style={{
                      padding: '0 24px 20px',
                      fontSize: 15,
                      lineHeight: 1.65,
                      color: 'var(--v4-text-secondary)',
                    }}
                  >
                    {item.a}
                  </div>
                </details>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      <section className="v4-scene v4-scene--short" id="seo-cta">
        <div className="v4-scene__bg">
          <BackgroundBeams />
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: 'radial-gradient(circle at 50% 110%, rgba(232,168,144,0.16), transparent 50%)',
            }}
          />
        </div>
        <div className="v4-scene__content" style={{ maxWidth: 720, textAlign: 'center' }}>
          <motion.h2 {...reveal} transition={{ duration: 0.9 }} className="v4-h2 v4-h2--serif">
            Стартовый — бесплатно, навсегда.
          </motion.h2>
          <motion.p {...reveal} transition={{ duration: 0.9, delay: 0.15 }} className="v4-lede" style={{ marginTop: 24, marginInline: 'auto' }}>
            Один ученик включён. Карта не нужна.
          </motion.p>
          <motion.div {...reveal} transition={{ duration: 0.9, delay: 0.3 }} style={{ marginTop: 40 }}>
            <Link
              href={ctaHref}
              className="v4-cta v4-cta--lg"
              onClick={() => track('seo_cta_clicked', { page: slug, cta: 'open_cabinet' })}
            >
              {ctaText} →
            </Link>
          </motion.div>
        </div>
      </section>

      <style>{`
        .v4-prose p { font-size: 17px; line-height: 1.7; color: var(--v4-text-secondary); margin: 0 0 18px; }
        .v4-prose p strong { color: var(--v4-text-primary); font-weight: 600; }
        .v4-prose ul { padding: 0 0 0 22px; margin: 0 0 18px; color: var(--v4-text-secondary); font-size: 16px; line-height: 1.7; }
        .v4-prose ul li { margin-bottom: 8px; }
        .v4-prose a { color: var(--v4-accent-end); text-decoration: underline; text-underline-offset: 4px; }
        .v4-seo-article details[open] summary span:last-child { transform: rotate(45deg); display: inline-block; transition: transform 200ms; }
      `}</style>
    </article>
  )
}
