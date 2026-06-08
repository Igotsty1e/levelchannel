'use client'

import Link from 'next/link'
import { motion } from 'framer-motion'

import { Spotlight } from '@/components/ui/aceternity/spotlight'

const reveal = {
  initial: { opacity: 0, y: 28 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: '-100px' },
}

const TRUST_POINTS = [
  'Карта не нужна',
  'Подписка — позже, если захочешь',
  'Без e-mail-спама',
]

export function C05Action() {
  return (
    <section className="v4-scene v4-scene--short" id="action">
      <div className="v4-scene__bg">
        <Spotlight className="-top-40 left-0 md:left-60 md:-top-20" fill="rgba(232,168,144,0.18)" />
      </div>
      <div className="v4-scene__content" style={{ maxWidth: 760, textAlign: 'center' }}>
        <motion.h2 {...reveal} transition={{ duration: 0.9 }} className="v4-h2 v4-h2--serif">
          Начни <span className="v4-em-warm">со Стартового.</span>
        </motion.h2>
        <motion.p
          {...reveal}
          transition={{ duration: 0.9, delay: 0.15 }}
          className="v4-lede"
          style={{ marginTop: 24, marginInline: 'auto' }}
        >
          Один ученик включён. Бесплатно навсегда. Тебе достаточно е-мейла.
        </motion.p>
        <motion.div
          {...reveal}
          transition={{ duration: 0.9, delay: 0.3 }}
          style={{ marginTop: 40, display: 'flex', gap: 16, justifyContent: 'center', flexWrap: 'wrap' }}
        >
          <Link
            href="/register?role=teacher&utm_source=landing-v4-c&utm_content=mid-cta"
            className="v4-cta v4-cta--lg"
          >
            Открыть кабинет →
          </Link>
          <a href="#bento" className="v4-cta v4-cta--lg v4-cta--ghost">
            Сначала посмотреть, что внутри
          </a>
        </motion.div>
        <motion.div
          {...reveal}
          transition={{ duration: 0.9, delay: 0.45 }}
          style={{
            marginTop: 36,
            display: 'inline-flex',
            gap: 28,
            flexWrap: 'wrap',
            justifyContent: 'center',
            color: 'var(--v4-text-muted)',
            fontSize: 13,
          }}
        >
          {TRUST_POINTS.map((p) => (
            <span key={p} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: 'var(--v4-accent-end)' }}>✓</span> {p}
            </span>
          ))}
        </motion.div>
      </div>
    </section>
  )
}
