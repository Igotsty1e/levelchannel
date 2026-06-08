'use client'

import Link from 'next/link'
import { motion } from 'framer-motion'

import { BackgroundBeams } from '@/components/ui/aceternity/background-beams'

const reveal = {
  initial: { opacity: 0, y: 30 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: '-100px' },
}

export function A08Final() {
  return (
    <section
      className="v4-scene"
      id="final"
      style={{ borderTop: '1px solid var(--v4-rule)' }}
    >
      <div className="v4-scene__bg">
        <BackgroundBeams />
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background:
              'radial-gradient(circle at 50% 110%, rgba(232,168,144,0.18), transparent 50%)',
          }}
        />
      </div>
      <div className="v4-scene__content" style={{ maxWidth: 880, textAlign: 'center' }}>
        <motion.h2 {...reveal} transition={{ duration: 0.9 }} className="v4-h2 v4-h2--serif" style={{ fontSize: 'clamp(34px, 5.5vw, 68px)' }}>
          Вернись к тому, <span className="v4-em-warm">ради чего ты в это пошла.</span>
        </motion.h2>
        <motion.p
          {...reveal}
          transition={{ duration: 0.9, delay: 0.15 }}
          className="v4-lede"
          style={{ marginTop: 28, marginInline: 'auto' }}
        >
          Стартовый — бесплатно, навсегда. Один ученик включён. Без карты, без таймера, без e-mail-спама.
        </motion.p>
        <motion.div
          {...reveal}
          transition={{ duration: 0.9, delay: 0.3 }}
          style={{ marginTop: 48, display: 'flex', gap: 16, justifyContent: 'center', flexWrap: 'wrap' }}
        >
          <Link
            href="/register?role=teacher&utm_source=landing-v4-a&utm_content=final-cta"
            className="v4-cta v4-cta--lg"
          >
            Открыть кабинет →
          </Link>
          <a href="#bento" className="v4-cta v4-cta--lg v4-cta--ghost">
            Сначала посмотреть
          </a>
        </motion.div>
        <motion.p
          {...reveal}
          transition={{ duration: 0.9, delay: 0.5 }}
          style={{ marginTop: 28, fontSize: 13, color: 'var(--v4-text-muted)' }}
        >
          Если передумаешь — просто закрой вкладку. Мы не звоним и не пишем «вы оставили заявку».
        </motion.p>
      </div>
    </section>
  )
}
