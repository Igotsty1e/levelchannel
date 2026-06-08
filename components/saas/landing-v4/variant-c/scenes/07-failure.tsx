'use client'

import { motion } from 'framer-motion'

const reveal = {
  initial: { opacity: 0, y: 28 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: '-100px' },
}

export function C07Failure() {
  return (
    <section className="v4-scene v4-scene--short" id="failure">
      <div className="v4-scene__bg" />
      <div className="v4-scene__content" style={{ maxWidth: 720, textAlign: 'center' }}>
        <motion.div
          {...reveal}
          transition={{ duration: 0.7 }}
          className="v4-eyebrow"
          style={{ marginBottom: 24 }}
        >
          Или
        </motion.div>
        <motion.h2 {...reveal} transition={{ duration: 0.9, delay: 0.1 }} className="v4-h2 v4-h2--serif">
          Или останешься <span className="v4-em-warm">в Excel.</span>
        </motion.h2>
        <motion.p
          {...reveal}
          transition={{ duration: 0.9, delay: 0.2 }}
          className="v4-lede"
          style={{ marginTop: 28, marginInline: 'auto', maxWidth: '55ch' }}
        >
          Это нормально. Excel работает. Просто посчитай, сколько часов в неделю ты к нему возвращаешься. И решай сама.
        </motion.p>
      </div>
    </section>
  )
}
