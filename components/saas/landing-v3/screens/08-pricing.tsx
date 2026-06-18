'use client'

import Link from 'next/link'
import { motion } from 'framer-motion'

import { track } from '@/lib/analytics/track'
import { BorderBeam } from '@/components/ui/aceternity'

const fadeUp = { initial: { opacity: 0, y: 40 }, whileInView: { opacity: 1, y: 0 }, viewport: { once: true, margin: '-100px' } }

type Tier = {
  id: 'free' | 'basic' | 'pro' | 'annual'
  name: string
  price: string
  period: string
  limit: string
  bullets: string[]
  ctaLabel: string
  ctaHref: string
  highlight?: boolean
  badge?: string
  /** A.2 (2026-06-18): annual карточка показывает плашку экономии (−15%). */
  annualSave?: {
    baseline: string
    label: string
  }
}

// A.2 annual tariff (2026-06-18): добавлена 3-я карточка «Оптимальный на год»
// (4 000 ₽ разовый платёж за 365 дней; экономия ~15% vs 12 × 399).
const TIERS: Tier[] = [
  {
    id: 'free',
    name: 'Стартовый',
    price: '0 ₽',
    period: 'навсегда',
    limit: 'до 3 активных учеников',
    bullets: [
      'Все функции платформы',
      'Расписание, слоты, дела',
      'Пакеты и тарифы',
      'Балансы и долги',
    ],
    ctaLabel: 'Начать бесплатно',
    ctaHref: '/register?role=teacher&utm_source=landing-v3&utm_content=pricing_free',
  },
  {
    id: 'basic',
    name: 'Оптимальный',
    price: '399 ₽',
    period: 'в месяц',
    limit: 'без ограничения по ученикам',
    bullets: [
      'Всё из «Стартового»',
      'Без лимита учеников',
      'Расширенная аналитика',
      'Приоритет в поддержке',
    ],
    ctaLabel: 'Подключить',
    ctaHref: '/teacher/subscription',
    highlight: true,
    badge: 'Популярный',
  },
  {
    id: 'annual',
    name: 'Оптимальный на год',
    price: '4 000 ₽',
    period: 'за год',
    limit: 'тот же функционал, разовый платёж',
    bullets: [
      'Всё из «Оптимального»',
      '365 дней без забот',
      'Без авто-продления',
      'Одна сумма за весь год',
    ],
    ctaLabel: 'Оплатить год',
    ctaHref: '/teacher/subscription?cycle=annual',
    annualSave: {
      baseline: '4 788 ₽',
      label: 'экономия 15%',
    },
  },
]

export function ScreenPricing() {
  return (
    <section id="pricing" className="landing-v3-section">
      <div style={{ textAlign: 'center', marginBottom: 56 }}>
        <motion.div {...fadeUp} transition={{ duration: 0.6 }} className="landing-v3-eyebrow" style={{ display: 'inline-flex' }}>
          Тарифы
        </motion.div>
        <motion.h2 {...fadeUp} transition={{ duration: 0.7, delay: 0.1 }} className="landing-v3-h2 landing-v3-h2--serif" style={{ marginTop: 16 }}>
          Попробуй бесплатно. <em>Год — выгоднее всего.</em>
        </motion.h2>
        <motion.p {...fadeUp} transition={{ duration: 0.7, delay: 0.2 }} className="landing-v3-lede" style={{ margin: '16px auto 0' }}>
          Стартовый — навсегда, до 3 учеников. Оптимальный — 399 ₽ в месяц, без ограничения по числу учеников. Год — разовый платёж 4 000 ₽, экономия 15%.
        </motion.p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 20, maxWidth: 1080, margin: '0 auto' }} className="landing-v3-tiers-grid">
        {TIERS.map((tier, idx) => (
          <motion.div
            key={tier.id}
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-100px' }}
            transition={{ duration: 0.6, delay: idx * 0.1 }}
            className="landing-v3-card"
            style={{
              position: 'relative',
              padding: 32,
              background: tier.highlight ? 'linear-gradient(180deg, rgba(200,120,120,0.08), var(--v3-surface))' : undefined,
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            {tier.highlight ? <BorderBeam size={250} duration={10} /> : null}
            {tier.badge ? (
              <div style={{ position: 'absolute', top: 16, right: 16, padding: '4px 10px', borderRadius: 999, background: 'var(--v3-accent-start)', color: '#1a1a1a', fontSize: 11, fontWeight: 600 }}>
                {tier.badge}
              </div>
            ) : null}
            <h3 style={{ fontSize: 18, fontWeight: 600, margin: 0, color: 'var(--v3-text-primary)', display: 'flex', flexDirection: 'column', minHeight: 48, justifyContent: 'flex-end' }}>{tier.name}</h3>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 16 }}>
              <span style={{ fontSize: 48, fontWeight: 700, letterSpacing: '-0.03em', color: 'var(--v3-text-primary)' }}>{tier.price}</span>
              <span style={{ fontSize: 14, color: 'var(--v3-text-muted)' }}>· {tier.period}</span>
            </div>
            <p style={{ fontSize: 13, color: 'var(--v3-text-muted)', margin: '8px 0 16px' }}>{tier.limit}</p>

            {tier.annualSave ? (
              <div
                data-testid="pricing-annual-save"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 10px',
                  background: 'rgba(74, 222, 128, 0.12)',
                  color: '#86efac',
                  borderRadius: 8,
                  fontSize: 12,
                  fontWeight: 600,
                  marginBottom: 12,
                  alignSelf: 'flex-start',
                }}
              >
                <span style={{ color: 'var(--v3-text-muted)', textDecoration: 'line-through', fontWeight: 500 }}>
                  {tier.annualSave.baseline}
                </span>
                <span>{tier.annualSave.label}</span>
              </div>
            ) : null}

            <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 32px', color: 'var(--v3-text-secondary)', fontSize: 14, lineHeight: 1.9, flex: '1 1 auto' }}>
              {tier.bullets.map((b) => (
                <li key={b}>· {b}</li>
              ))}
            </ul>

            <Link
              href={tier.ctaHref}
              className="landing-v3-cta"
              onClick={() => track('pricing_tier_clicked', { tier: tier.id === 'annual' ? 'basic' : tier.id, tier_name: tier.name as 'Стартовый' | 'Оптимальный' | 'Оптимальный на год' })}
              style={{
                width: '100%',
                justifyContent: 'center',
                background: tier.highlight ? undefined : 'var(--v3-surface-elevated)',
                color: tier.highlight ? '#1a1a1a' : 'var(--v3-text-primary)',
                boxShadow: tier.highlight ? undefined : 'none',
                border: tier.highlight ? undefined : '1px solid var(--v3-rule-strong)',
                marginTop: 'auto',
              }}
            >
              {tier.ctaLabel}
            </Link>
          </motion.div>
        ))}
      </div>

      <p style={{ textAlign: 'center', marginTop: 32, fontSize: 13, color: 'var(--v3-text-muted)' }}>
        Без карты при регистрации. Оплата только при переходе на платный тариф.
      </p>

      <style>{`
        @media (max-width: 760px) {
          .landing-v3-tiers-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </section>
  )
}
