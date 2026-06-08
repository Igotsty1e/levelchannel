'use client'

import { motion } from 'framer-motion'

import { AuroraBackground } from '@/components/ui/aceternity/aurora-background'

const slowFade = {
  initial: { opacity: 0, y: 24 },
  animate: { opacity: 1, y: 0 },
}

export function A01Opening() {
  return (
    <section className="v4-scene" id="opening">
      <div className="v4-scene__bg">
        <AuroraBackground />
      </div>
      <div className="v4-scene__content" style={{ maxWidth: 920, textAlign: 'center' }}>
        <motion.h1
          className="v4-h1 v4-h1--serif"
          {...slowFade}
          transition={{ duration: 1.4, ease: [0.16, 1, 0.3, 1] }}
        >
          Ты не устаёшь <span className="v4-em-warm">от уроков.</span>
        </motion.h1>
        <motion.p
          className="v4-lede"
          {...slowFade}
          transition={{ duration: 1.4, ease: [0.16, 1, 0.3, 1], delay: 1.1 }}
          style={{ marginTop: 32, marginLeft: 'auto', marginRight: 'auto' }}
        >
          Ты устаёшь от того, что между ними. От переписок, от «можем перенести», от «реквизиты ещё раз пришлите».
        </motion.p>
      </div>
    </section>
  )
}
