'use client'

import { motion } from 'framer-motion'

export function A04Evening() {
  return (
    <section
      className="v4-scene"
      id="evening"
      style={{
        background: 'radial-gradient(ellipse at center, rgba(232,168,144,0.06) 0%, transparent 60%)',
      }}
    >
      <div className="v4-scene__bg" />
      <div className="v4-scene__content" style={{ maxWidth: 880, textAlign: 'center' }}>
        <motion.h2
          className="v4-h2 v4-h2--serif"
          initial={{ opacity: 0, y: 32 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-100px' }}
          transition={{ duration: 1.6, ease: [0.16, 1, 0.3, 1] }}
          style={{ fontSize: 'clamp(34px, 5vw, 64px)' }}
        >
          Ты помнишь, ради чего <span className="v4-em-warm">ты в это пошла.</span>
        </motion.h2>

        <motion.p
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-100px' }}
          transition={{ duration: 1.4, ease: [0.16, 1, 0.3, 1], delay: 1.2 }}
          className="v4-lede"
          style={{ marginTop: 40, marginInline: 'auto', fontSize: 'clamp(17px, 1.8vw, 22px)' }}
        >
          Ты больше не помнишь, когда последний раз чувствовала это.
        </motion.p>

        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true, margin: '-100px' }}
          transition={{ duration: 2, delay: 2.6 }}
          style={{ marginTop: 64, color: 'var(--v4-text-muted)', fontSize: 13, letterSpacing: '0.1em', textTransform: 'uppercase' }}
        >
          ↓
        </motion.div>
      </div>
    </section>
  )
}
