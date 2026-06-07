'use client'

import { motion } from 'framer-motion'

const fadeUp = { initial: { opacity: 0, y: 40 }, whileInView: { opacity: 1, y: 0 }, viewport: { once: true, margin: '-100px' } }

type Feature = {
  title: string
  body: string
  icon: React.ReactNode
}

const FEATURES: Feature[] = [
  {
    title: 'Расписание, которое видишь не только ты.',
    body: 'Слоты, которые ученик и его родитель видят в своём календаре. Перенос — две секунды. Конфликтов нет. Напоминание уходит автоматически за час.',
    icon: (
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#E8A890" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <path d="M16 2v4M8 2v4M3 10h18" />
      </svg>
    ),
  },
  {
    title: 'Карточка ученика — то, что ты обещал помнить.',
    body: 'Имя, уровень, цели, заметки про слабые места. Что разбирали на прошлом уроке. Что задал. Что готовить сегодня. Не в голове, а в одном месте.',
    icon: (
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#E8A890" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    ),
  },
  {
    title: 'Кто кому должен — больше не в твоей голове.',
    body: 'Списали с пакета — автоматически. Пришла оплата — обновилось. Видишь сразу: у Пети ещё четыре урока, Маша должна за два.',
    icon: (
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#E8A890" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <line x1="12" y1="1" x2="12" y2="23" />
        <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
      </svg>
    ),
  },
  {
    title: 'Пакеты на 4, 8, 16 уроков — без шаблонов в Word.',
    body: 'Создаёшь тариф один раз. Назначаешь ученику пакет — он автоматически списывается урок за уроком. История остаётся.',
    icon: (
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#E8A890" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
        <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
        <line x1="12" y1="22.08" x2="12" y2="12" />
      </svg>
    ),
  },
]

export function ScreenFeatures() {
  return (
    <section id="features" className="landing-v3-section">
      <div style={{ maxWidth: 920, margin: '0 auto 64px', textAlign: 'center' }}>
        <motion.h2
          {...fadeUp}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          className="landing-v3-h2 landing-v3-h2--serif"
        >
          Один экран. <em>Знает всё.</em>
        </motion.h2>
        <motion.p
          {...fadeUp}
          transition={{ duration: 0.7, delay: 0.1 }}
          className="landing-v3-lede"
          style={{ marginTop: 24, marginLeft: 'auto', marginRight: 'auto' }}
        >
          Расписание, ученики, балансы, пакеты. Только то, что репетитор реально открывает каждый день.
          Всё в одном кабинете. Без рассыпанных Telegram-чатов, Excel-таблиц и шаблонов в Word.
        </motion.p>
        <motion.p
          {...fadeUp}
          transition={{ duration: 0.7, delay: 0.2 }}
          style={{ marginTop: 16, color: 'var(--v3-accent-end)', fontSize: 16, fontStyle: 'italic' }}
        >
          Сделан специально под частного репетитора. Без лишнего, с самым необходимым.
        </motion.p>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, 1fr)',
          gap: 16,
          maxWidth: 1100,
          margin: '0 auto',
        }}
      >
        {FEATURES.map((f, idx) => (
          <motion.div
            key={f.title}
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ duration: 0.6, delay: idx * 0.08 }}
            className="landing-v3-card"
            style={{ padding: 32 }}
          >
            <div style={{ marginBottom: 20 }}>{f.icon}</div>
            <h3 style={{ fontSize: 18, fontWeight: 600, margin: '0 0 12px', color: 'var(--v3-text-primary)' }}>
              {f.title}
            </h3>
            <p style={{ fontSize: 15, lineHeight: 1.6, color: 'var(--v3-text-secondary)', margin: 0 }}>
              {f.body}
            </p>
          </motion.div>
        ))}
      </div>

    </section>
  )
}
