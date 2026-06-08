'use client'

import { motion } from 'framer-motion'

import { BackgroundBeams } from '@/components/ui/aceternity/background-beams'

const reveal = {
  initial: { opacity: 0, y: 28 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: '-100px' },
}

export function C03Guide() {
  return (
    <section className="v4-scene" id="guide" style={{ minHeight: '90vh' }}>
      <div className="v4-scene__bg">
        <BackgroundBeams />
      </div>
      <div className="v4-scene__content" style={{ maxWidth: 880, textAlign: 'center' }}>
        <motion.div
          {...reveal}
          transition={{ duration: 0.9 }}
          style={{
            width: 80,
            height: 80,
            borderRadius: 16,
            background: 'linear-gradient(135deg, var(--v4-accent-start), var(--v4-accent-end))',
            margin: '0 auto 40px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'var(--v4-font-serif)',
            fontSize: 36,
            color: 'var(--v4-bg)',
            fontWeight: 700,
            boxShadow: '0 20px 60px -16px rgba(232,168,144,0.4)',
          }}
        >
          L
        </motion.div>
        <motion.h2 {...reveal} transition={{ duration: 1, delay: 0.15 }} className="v4-h2 v4-h2--serif">
          Мы это <span className="v4-em-warm">уже видели.</span>
        </motion.h2>
        <motion.p
          {...reveal}
          transition={{ duration: 1, delay: 0.3 }}
          className="v4-lede"
          style={{ marginTop: 28, marginInline: 'auto' }}
        >
          LevelChannel — это кабинет, собранный частными репетиторами для частных репетиторов. Мы прошли это сами. Поэтому мы знаем, чего тебе не надо.
        </motion.p>
        <motion.ul
          {...reveal}
          transition={{ duration: 1, delay: 0.5 }}
          style={{
            listStyle: 'none',
            padding: 0,
            margin: '40px auto 0',
            maxWidth: 580,
            display: 'grid',
            gap: 16,
            textAlign: 'left',
          }}
        >
          {[
            'Не надо учиться софту с тремя уровнями меню.',
            'Не надо ставить приложение — открывается в любом браузере.',
            'Не надо доверять данные тем, кто потом продаёт по ним рекламу.',
          ].map((line, i) => (
            <motion.li
              key={line}
              initial={{ opacity: 0, x: -16 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true, margin: '-80px' }}
              transition={{ duration: 0.6, delay: 0.6 + i * 0.1 }}
              style={{
                display: 'flex',
                gap: 14,
                alignItems: 'flex-start',
                fontSize: 16,
                color: 'var(--v4-text-secondary)',
                lineHeight: 1.6,
              }}
            >
              <span
                style={{
                  flexShrink: 0,
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: 'var(--v4-accent-end)',
                  marginTop: 10,
                }}
              />
              {line}
            </motion.li>
          ))}
        </motion.ul>
      </div>
    </section>
  )
}
