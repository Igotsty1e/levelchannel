'use client'

import { motion } from 'framer-motion'

import { track } from '@/lib/analytics/track'

const reveal = {
  initial: { opacity: 0, y: 28 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: '-120px' },
}

export function ScreenPullquote() {
  return (
    <section
      id="pullquote"
      className="landing-v3-section"
      style={{
        position: 'relative',
        padding: 'clamp(56px, 10vh, 112px) clamp(24px, 5vw, 80px)',
      }}
    >
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'radial-gradient(ellipse 60% 50% at 30% 50%, rgba(232,168,144,0.06) 0%, transparent 60%)',
          pointerEvents: 'none',
        }}
      />

      <div
        style={{
          position: 'relative',
          maxWidth: 880,
          margin: '0 auto',
          textAlign: 'center',
        }}
      >
        <motion.div
          {...reveal}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          style={{
            fontSize: 14,
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            color: 'var(--v3-text-muted)',
            marginBottom: 28,
          }}
        >
          Из отзыва
        </motion.div>

        <motion.blockquote
          {...reveal}
          onViewportEnter={() => track('pullquote_visible', {})}
          transition={{ duration: 0.9, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
          style={{
            fontFamily: 'var(--v3-font-serif, Charter, "Iowan Old Style", Georgia, serif)',
            fontSize: 'clamp(28px, 4.4vw, 48px)',
            lineHeight: 1.25,
            fontStyle: 'italic',
            color: 'var(--v3-text-primary)',
            margin: 0,
            fontWeight: 400,
            letterSpacing: '-0.01em',
          }}
        >
          <span style={{ color: 'var(--v3-accent-end)', fontWeight: 600 }}>«</span>
          За первый месяц я не написал ни одного «не забудь, у нас сегодня». И в первый раз за два года точно знал, кто оплатил февраль.
          <span style={{ color: 'var(--v3-accent-end)', fontWeight: 600 }}>»</span>
        </motion.blockquote>

        <motion.div
          {...reveal}
          transition={{ duration: 0.7, delay: 0.3 }}
          style={{
            marginTop: 40,
            fontSize: 13,
            color: 'var(--v3-text-secondary)',
            letterSpacing: '0.02em',
          }}
        >
          <strong style={{ color: 'var(--v3-text-primary)', fontWeight: 600 }}>Алексей К.</strong>{' '}
          · математика, 9 учеников · Челябинск
        </motion.div>
      </div>
    </section>
  )
}
