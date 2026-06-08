'use client'

import { motion } from 'framer-motion'

import { LaptopFrame, FrameImage } from '../../_shared/device-frame'

const reveal = {
  initial: { opacity: 0, y: 28 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: '-100px' },
}

export function C06Success() {
  return (
    <section className="v4-scene" id="success">
      <div className="v4-scene__bg">
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background:
              'radial-gradient(ellipse at center, rgba(232,168,144,0.08) 0%, transparent 50%)',
          }}
        />
      </div>
      <div className="v4-scene__content" style={{ maxWidth: 1100, display: 'grid', gap: 56 }}>
        <div style={{ textAlign: 'center', maxWidth: 760, marginInline: 'auto' }}>
          <motion.div {...reveal} transition={{ duration: 0.7 }} className="v4-eyebrow" style={{ marginBottom: 20 }}>
            И вот тогда
          </motion.div>
          <motion.h2 {...reveal} transition={{ duration: 0.9, delay: 0.1 }} className="v4-h2 v4-h2--serif">
            Вечером ты <span className="v4-em-warm">снова педагог.</span>
          </motion.h2>
          <motion.p
            {...reveal}
            transition={{ duration: 0.9, delay: 0.2 }}
            className="v4-lede"
            style={{ marginTop: 24, marginInline: 'auto' }}
          >
            Не администратор. Не бухгалтер. Не диспетчер. Просто учитель, у которого спокойно прошёл день.
          </motion.p>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 60 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1], delay: 0.3 }}
          style={{ position: 'relative' }}
        >
          <LaptopFrame tilt={1}>
            <FrameImage
              src="/assets/landing-v4/screens/teacher-dashboard.png"
              alt="Кабинет учителя — спокойный вечер"
            />
          </LaptopFrame>
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.9 }}
            whileInView={{ opacity: 1, y: 0, scale: 1 }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ duration: 0.7, delay: 1.3, ease: [0.16, 1, 0.3, 1] }}
            style={{
              position: 'absolute',
              right: '5%',
              bottom: -28,
              background: 'var(--v4-elevated)',
              border: '1px solid var(--v4-rule-strong)',
              borderRadius: 12,
              padding: '14px 18px',
              boxShadow: '0 20px 40px -12px rgba(0,0,0,0.6)',
              maxWidth: 320,
            }}
          >
            <div
              style={{
                fontSize: 11,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: 'var(--v4-text-muted)',
                marginBottom: 4,
              }}
            >
              Telegram → Маша
            </div>
            <div style={{ fontSize: 14, color: 'var(--v4-text-primary)', lineHeight: 1.5 }}>
              Перенос на четверг 14:00 подтверждён ·{' '}
              <span style={{ color: 'var(--v4-accent-end)' }}>отправлено ученику</span>
            </div>
          </motion.div>
        </motion.div>
      </div>
    </section>
  )
}
