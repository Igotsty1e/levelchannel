'use client'

import { motion } from 'framer-motion'

import { AuroraBackground } from '@/components/ui/aceternity/aurora-background'

const reveal = {
  initial: { opacity: 0, y: 28 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: '-100px' },
}

export function C01Character() {
  return (
    <section className="v4-scene" id="character">
      <div className="v4-scene__bg">
        <AuroraBackground />
      </div>
      <div className="v4-scene__content" style={{ maxWidth: 920, textAlign: 'center' }}>
        <motion.div
          {...reveal}
          transition={{ duration: 0.7 }}
          className="v4-eyebrow"
          style={{ marginBottom: 24 }}
        >
          Кабинет для частного репетитора
        </motion.div>
        <motion.h1
          {...reveal}
          transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1], delay: 0.1 }}
          className="v4-h1 v4-h1--serif"
          style={{ marginBottom: 32 }}
        >
          Ты любишь то, что делаешь. <br />
          <span className="v4-em-warm">К вечеру всё равно валишься с ног.</span>
        </motion.h1>
        <motion.p
          {...reveal}
          transition={{ duration: 1.1, delay: 0.35 }}
          className="v4-lede"
          style={{ marginInline: 'auto' }}
        >
          14 учеников. 47 непрочитанных в Telegram. Блокнот с пометками «Петя — февраль, 4 урока, оплачено». Excel'у четвёртый год. Это твой неоплаченный администраторский день.
        </motion.p>
      </div>
    </section>
  )
}
