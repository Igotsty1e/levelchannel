'use client'

import { motion } from 'framer-motion'

const reveal = {
  initial: { opacity: 0, y: 28 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: '-100px' },
}

const PROBLEMS = [
  { stat: '×3', body: 'сервиса задействованы, чтобы провести одно занятие' },
  { stat: '×5', body: 'переписок на один перенос — пока согласовали, прошло сорок минут' },
  { stat: '~2 ч', body: 'каждый месяц на «кто оплатил, кто должен» по чатам и переводам' },
  { stat: '47', body: 'непрочитанных в Telegram к вечеру, потому что ты живая' },
]

export function C02Problem() {
  return (
    <section className="v4-scene" id="problem">
      <div
        className="v4-scene__bg"
        style={{
          backgroundImage:
            'radial-gradient(circle at 1px 1px, rgba(255,255,255,0.04) 1px, transparent 0)',
          backgroundSize: '24px 24px',
        }}
      />
      <div className="v4-scene__content" style={{ maxWidth: 1100 }}>
        <div style={{ textAlign: 'center', maxWidth: 760, marginInline: 'auto', marginBottom: 56 }}>
          <motion.h2 {...reveal} transition={{ duration: 0.9 }} className="v4-h2 v4-h2--serif">
            Сложно, <span className="v4-em-warm">потому что:</span>
          </motion.h2>
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 24,
            maxWidth: 1100,
            marginInline: 'auto',
            marginBottom: 56,
          }}
        >
          {PROBLEMS.map((p, i) => (
            <motion.div
              key={p.stat}
              initial={{ opacity: 0, y: 32 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-80px' }}
              transition={{ duration: 0.7, delay: i * 0.08, ease: [0.16, 1, 0.3, 1] }}
              className="v4-card"
              style={{ padding: '32px 28px' }}
            >
              <div
                style={{
                  fontFamily: 'var(--v4-font-serif)',
                  fontSize: 48,
                  lineHeight: 1,
                  color: 'var(--v4-accent-end)',
                  marginBottom: 16,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {p.stat}
              </div>
              <p className="v4-body" style={{ fontSize: 14, lineHeight: 1.5 }}>
                {p.body}
              </p>
            </motion.div>
          ))}
        </div>
        <motion.p
          {...reveal}
          transition={{ duration: 0.9, delay: 0.4 }}
          className="v4-pullquote"
          style={{ maxWidth: 760, marginInline: 'auto' }}
        >
          Ты не устаёшь от уроков. Ты устаёшь от админ-работы, на которую тебя не учили.
        </motion.p>
      </div>
    </section>
  )
}
