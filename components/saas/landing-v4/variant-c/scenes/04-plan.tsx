'use client'

import { motion } from 'framer-motion'

const reveal = {
  initial: { opacity: 0, y: 28 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: '-100px' },
}

const STEPS = [
  {
    n: '01',
    title: 'Открыть кабинет',
    body: 'Регистрация по e-mail. Карта не нужна. Стартовый бесплатно — навсегда.',
  },
  {
    n: '02',
    title: 'Добавить ученика',
    body: 'Имя, уровень, контакт родителя. Календарь подключается одной кнопкой.',
  },
  {
    n: '03',
    title: 'Жить',
    body: 'Расписание, баланс, оплаты, отчёт — кабинет берёт на себя. Ты возвращаешься к подготовке к уроку.',
  },
]

export function C04Plan() {
  return (
    <section className="v4-scene" id="plan" style={{ minHeight: 'auto', padding: 'var(--v4-scene-py) var(--v4-scene-px)' }}>
      <div
        className="v4-scene__bg"
        style={{
          background: 'linear-gradient(180deg, transparent, rgba(26,24,24,0.4) 60%, transparent)',
        }}
      />
      <div className="v4-scene__content" style={{ maxWidth: 1180 }}>
        <div style={{ textAlign: 'center', maxWidth: 720, marginInline: 'auto', marginBottom: 64 }}>
          <motion.div {...reveal} transition={{ duration: 0.7 }} className="v4-eyebrow" style={{ marginBottom: 20 }}>
            План
          </motion.div>
          <motion.h2 {...reveal} transition={{ duration: 0.9, delay: 0.1 }} className="v4-h2 v4-h2--serif">
            Три шага. <span className="v4-em-warm">Без сюрпризов.</span>
          </motion.h2>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
            gap: 20,
            maxWidth: 1180,
            marginInline: 'auto',
            position: 'relative',
          }}
        >
          {STEPS.map((s, i) => (
            <motion.div
              key={s.n}
              initial={{ opacity: 0, y: 32 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-80px' }}
              transition={{ duration: 0.7, delay: i * 0.15, ease: [0.16, 1, 0.3, 1] }}
              className="v4-card"
              style={{ padding: 32, position: 'relative' }}
            >
              <div
                style={{
                  fontFamily: 'var(--v4-font-serif)',
                  fontSize: 14,
                  color: 'var(--v4-accent-end)',
                  letterSpacing: '0.1em',
                  marginBottom: 24,
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: 12,
                }}
              >
                <span style={{ fontSize: 12, color: 'var(--v4-text-muted)' }}>{s.n}</span>
                <span
                  style={{
                    flex: 1,
                    height: 1,
                    background: 'var(--v4-rule)',
                  }}
                />
              </div>
              <h3 className="v4-h3" style={{ fontSize: 22, marginBottom: 12 }}>
                {s.title}
              </h3>
              <p className="v4-body" style={{ fontSize: 14, lineHeight: 1.6 }}>
                {s.body}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}
