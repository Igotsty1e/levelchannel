'use client'

import { motion } from 'framer-motion'

const reveal = {
  initial: { opacity: 0, y: 28 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: '-120px' },
}

const NOTES = [
  { text: 'Петя — февраль 4 урока оплачено', crossed: true, n: 1 },
  { text: 'Аня — пакет на 8, остаётся 3', crossed: false, n: 2 },
  { text: 'Кирилл — забыл что задал', crossed: false, n: 3 },
  { text: 'Маша оплатила?', crossed: true, n: 4 },
  { text: 'Аня — пакет на 8, остаётся 2', crossed: false, n: 5 },
  { text: 'Сама не помню за январь', crossed: false, n: 6 },
]

export function A03Noon() {
  return (
    <section className="v4-scene" id="noon">
      <div
        className="v4-scene__bg"
        style={{
          background:
            'linear-gradient(180deg, transparent 0%, rgba(26,24,24,0.4) 60%, transparent 100%)',
        }}
      />
      <div
        className="v4-scene__content"
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr)',
          gap: 56,
          maxWidth: 920,
        }}
      >
        <div style={{ textAlign: 'center' }}>
          <motion.h2 className="v4-h2 v4-h2--serif" {...reveal} transition={{ duration: 0.9 }}>
            К полудню ты не помнишь, <span className="v4-em-warm">кто за что заплатил.</span>
          </motion.h2>
          <motion.p
            className="v4-lede"
            {...reveal}
            transition={{ duration: 0.9, delay: 0.15 }}
            style={{ marginTop: 24, marginInline: 'auto' }}
          >
            Помнишь смутно. Кажется, Маша должна, а Аня нет. Или наоборот.
          </motion.p>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 32 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1], delay: 0.3 }}
          style={{
            background: 'var(--v4-warm-surface)',
            border: '1px solid var(--v4-rule)',
            borderRadius: 4,
            padding: '40px clamp(24px, 5vw, 56px)',
            position: 'relative',
            boxShadow: '0 30px 80px -30px rgba(0,0,0,0.6)',
            transform: 'rotate(-0.4deg)',
            backgroundImage:
              'repeating-linear-gradient(180deg, transparent 0, transparent 31px, rgba(255,255,255,0.04) 31px, rgba(255,255,255,0.04) 32px)',
          }}
        >
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 0 }}>
            {NOTES.map((n, i) => (
              <motion.li
                key={i}
                initial={{ opacity: 0, x: -16 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true, margin: '-80px' }}
                transition={{ duration: 0.5, delay: 0.5 + i * 0.18 }}
                style={{
                  position: 'relative',
                  fontFamily: 'Caveat, "Bradley Hand", cursive',
                  fontSize: 22,
                  lineHeight: '32px',
                  color: n.crossed ? 'var(--v4-text-muted)' : 'var(--v4-text-secondary)',
                  textDecoration: n.crossed ? 'line-through' : 'none',
                  textDecorationColor: 'var(--v4-accent-start)',
                  padding: '0 0 0 28px',
                }}
              >
                <span style={{ position: 'absolute', left: 0, color: 'var(--v4-text-muted)', fontSize: 14, top: 2 }}>·</span>
                {n.text}
              </motion.li>
            ))}
          </ul>
        </motion.div>
      </div>
    </section>
  )
}
