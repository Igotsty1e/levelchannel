'use client'

import { motion } from 'framer-motion'

import { LaptopFrame, FrameImage } from '../../_shared/device-frame'

export function A05Once() {
  return (
    <section className="v4-scene" id="once">
      <div className="v4-scene__bg">
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background:
              'radial-gradient(ellipse 80% 60% at 50% 70%, rgba(232,168,144,0.10) 0%, transparent 50%)',
          }}
        />
      </div>
      <div className="v4-scene__content" style={{ maxWidth: 1100, display: 'grid', gap: 56 }}>
        <div style={{ textAlign: 'center', maxWidth: 760, marginInline: 'auto' }}>
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-100px' }}
            transition={{ duration: 0.7 }}
            className="v4-eyebrow"
            style={{ marginBottom: 24 }}
          >
            Однажды
          </motion.div>
          <motion.h2
            className="v4-h2 v4-h2--serif"
            initial={{ opacity: 0, y: 28 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-100px' }}
            transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1], delay: 0.2 }}
          >
            Ты открыла <span className="v4-em-warm">один экран.</span>
          </motion.h2>
          <motion.p
            className="v4-lede"
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-100px' }}
            transition={{ duration: 0.9, delay: 0.35 }}
            style={{ marginTop: 24, marginInline: 'auto' }}
          >
            Расписание, ученики, балансы, пакеты. Всё, что ты обычно искала по шести вкладкам, — в одной открытой странице.
          </motion.p>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 60 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-100px' }}
          transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1], delay: 0.5 }}
        >
          <LaptopFrame tilt={2}>
            <FrameImage
              src="/assets/landing-v4/screens/teacher-dashboard.png"
              alt="Кабинет учителя — главная страница"
            />
          </LaptopFrame>
        </motion.div>
      </div>
    </section>
  )
}
