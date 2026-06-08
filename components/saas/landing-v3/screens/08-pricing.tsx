'use client'

import Link from 'next/link'
import { motion } from 'framer-motion'

import { track } from '@/lib/analytics/track'
import { BorderBeam } from '@/components/ui/aceternity'

const fadeUp = { initial: { opacity: 0, y: 40 }, whileInView: { opacity: 1, y: 0 }, viewport: { once: true, margin: '-100px' } }

type Tier = {
  id: 'free' | 'basic' | 'pro'
  name: string
  price: string
  period: string
  limit: string
  bullets: string[]
  ctaLabel: string
  ctaHref: string
  highlight?: boolean
  badge?: string
}

const TIERS: Tier[] = [
  {
    id: 'free',
    name: 'Стартовый',
    price: '0 ₽',
    period: 'навсегда',
    limit: 'до 1 активного ученика',
    bullets: [
      'Расписание и слоты',
      '1 пакет и 1 тариф (для знакомства)',
      'Балансы и долги',
      'История уроков',
    ],
    ctaLabel: 'Начать бесплатно',
    ctaHref: '/register?role=teacher&utm_source=landing-v3&utm_content=pricing_free',
  },
  {
    id: 'basic',
    name: 'Базовый',
    price: '300 ₽',
    period: 'в месяц',
    limit: 'до 5 активных учеников',
    bullets: [
      'Всё из «Стартового»',
      'Пакеты и абонементы без лимита',
      'Тарифы без лимита',
      'Балансы и долги',
    ],
    ctaLabel: 'Подключить',
    ctaHref: '/teacher/subscription',
  },
  {
    id: 'pro',
    name: 'Расширенный',
    price: '800 ₽',
    period: 'в месяц',
    limit: 'до 30 активных учеников',
    bullets: [
      'Всё из «Базового»',
      'Расширенные отчёты',
      'Приоритетная поддержка',
      'Прямые ответы оператора',
    ],
    ctaLabel: 'Подключить',
    ctaHref: '/teacher/subscription',
    highlight: true,
    badge: 'Популярный',
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
          Платишь только <em>за активных учеников.</em>
        </motion.h2>
        <motion.p {...fadeUp} transition={{ duration: 0.7, delay: 0.2 }} className="landing-v3-lede" style={{ margin: '16px auto 0' }}>
          Стартовый — навсегда. Базовый и Расширенный включаются сами, когда у тебя становится больше одного ученика.
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
            }}
          >
            {tier.highlight ? <BorderBeam size={250} duration={10} /> : null}
            {tier.badge ? (
              <div style={{ position: 'absolute', top: 16, right: 16, padding: '4px 10px', borderRadius: 999, background: 'var(--v3-accent-start)', color: '#1a1a1a', fontSize: 11, fontWeight: 600 }}>
                {tier.badge}
              </div>
            ) : null}
            <h3 style={{ fontSize: 18, fontWeight: 600, margin: 0, color: 'var(--v3-text-primary)' }}>{tier.name}</h3>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 16 }}>
              <span style={{ fontSize: 48, fontWeight: 700, letterSpacing: '-0.03em', color: 'var(--v3-text-primary)' }}>{tier.price}</span>
              <span style={{ fontSize: 14, color: 'var(--v3-text-muted)' }}>· {tier.period}</span>
            </div>
            <p style={{ fontSize: 13, color: 'var(--v3-text-muted)', margin: '8px 0 24px' }}>{tier.limit}</p>

            <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 32px', color: 'var(--v3-text-secondary)', fontSize: 14, lineHeight: 1.9 }}>
              {tier.bullets.map((b) => (
                <li key={b}>· {b}</li>
              ))}
            </ul>

            <Link
              href={tier.ctaHref}
              className="landing-v3-cta"
              onClick={() => track('pricing_tier_clicked', { tier: tier.id, tier_name: tier.name as 'Стартовый' | 'Базовый' | 'Расширенный' })}
              style={{
                width: '100%',
                justifyContent: 'center',
                background: tier.highlight ? undefined : 'var(--v3-surface-elevated)',
                color: tier.highlight ? '#1a1a1a' : 'var(--v3-text-primary)',
                boxShadow: tier.highlight ? undefined : 'none',
                border: tier.highlight ? undefined : '1px solid var(--v3-rule-strong)',
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
