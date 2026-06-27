'use client'

import Link from 'next/link'
import { motion } from 'framer-motion'

import { BackgroundBeams } from '@/components/ui/aceternity'

const fadeUp = { initial: { opacity: 0, y: 40 }, whileInView: { opacity: 1, y: 0 }, viewport: { once: true, margin: '-100px' } }

export function ScreenCta() {
  return (
    <section
      style={{
        position: 'relative',
        minHeight: '70vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '140px 24px 180px',
        overflow: 'hidden',
        borderTop: '1px solid var(--v3-rule)',
      }}
    >
      <BackgroundBeams />

      <div style={{ position: 'relative', zIndex: 2, maxWidth: 1000, textAlign: 'center' }}>
        <motion.h2 {...fadeUp} transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }} className="landing-v3-h2 landing-v3-h2--serif">
          Пять вкладок. <em>Один кабинет.</em>
        </motion.h2>
        <motion.p {...fadeUp} transition={{ duration: 0.7, delay: 0.2 }} className="landing-v3-lede" style={{ marginTop: 24, marginLeft: 'auto', marginRight: 'auto' }}>
          На Стартовом всё бесплатно, навсегда, до 3 учеников. Карта не нужна, мы не звоним.
        </motion.p>
        <motion.div {...fadeUp} transition={{ duration: 0.7, delay: 0.4 }} style={{ marginTop: 40, display: 'flex', gap: 16, justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link
            href="/register?role=teacher&utm_source=landing-v3&utm_content=cta_final"
            className="landing-v3-cta"
            style={{ fontSize: 18, padding: '22px 44px' }}
          >
            Открыть кабинет →
          </Link>
        </motion.div>
        <motion.p {...fadeUp} transition={{ duration: 0.7, delay: 0.6 }} style={{ marginTop: 24, fontSize: 14, color: 'var(--v3-text-muted)' }}>
          <a href="#pricing" className="landing-v3-link">Сначала посмотреть тарифы</a>
        </motion.p>
      </div>
    </section>
  )
}
