'use client'

import { motion } from 'framer-motion'

const fadeUp = { initial: { opacity: 0, y: 30 }, whileInView: { opacity: 1, y: 0 }, viewport: { once: true, margin: '-80px' } }

type Integration = {
  title: string
  body: string
  icon: React.ReactNode
}

const INTEGRATIONS: Integration[] = [
  {
    title: 'Google Calendar',
    body: 'Слоты, которые ты создал в LevelChannel, появляются у тебя и у ученика в обычном Google-календаре. Никаких ручных переносов.',
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#E8A890" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
        <path d="M8 14l2 2 4-4" />
      </svg>
    ),
  },
  {
    title: 'Telegram-уведомления',
    body: 'Ученик получает напоминание о занятии в свой Telegram. Никакого «забыл, что у нас сегодня».',
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#E8A890" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M22 2L11 13" />
        <path d="M22 2l-7 20-4-9-9-4 20-7z" />
      </svg>
    ),
  },
  {
    title: 'Email-нотификации',
    body: 'Подтверждения, переносы, отмены — отправляются ученику и родителю на почту. Тебе не нужно копировать-вставлять.',
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#E8A890" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
        <polyline points="22,6 12,13 2,6" />
      </svg>
    ),
  },
  {
    title: 'Дайджесты',
    body: 'В сервисе и на почту — сводка за день и за неделю: кто пришёл, кто перенёс, у кого истёк пакет. Утром одной строкой, без рысканья по экранам.',
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#E8A890" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="9" y1="13" x2="15" y2="13" />
        <line x1="9" y1="17" x2="13" y2="17" />
      </svg>
    ),
  },
]

export function ScreenIntegrations() {
  return (
    <section id="integrations" className="landing-v3-section">
      <div style={{ textAlign: 'center', marginBottom: 56 }}>
        <motion.div {...fadeUp} transition={{ duration: 0.6 }} className="landing-v3-eyebrow" style={{ display: 'inline-flex' }}>
          Интеграции
        </motion.div>
        <motion.h2
          {...fadeUp}
          transition={{ duration: 0.7, delay: 0.1 }}
          className="landing-v3-h2 landing-v3-h2--serif"
          style={{ marginTop: 16 }}
        >
          Подключаются к тому, <em>чем ты уже пользуешься.</em>
        </motion.h2>
        <motion.p {...fadeUp} transition={{ duration: 0.7, delay: 0.2 }} className="landing-v3-lede" style={{ margin: '20px auto 0' }}>
          Слоты автоматически появляются в Google-календаре. Напоминания идут в Telegram.
          Подтверждения и переносы уходят на почту. Тебе ничего не нужно копировать руками.
        </motion.p>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, 1fr)',
          gap: 12,
          maxWidth: 980,
          margin: '0 auto',
        }}
      >
        {INTEGRATIONS.map((it, idx) => (
          <motion.div
            key={it.title}
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ duration: 0.5, delay: idx * 0.07 }}
            className="landing-v3-card"
            style={{
              padding: 24,
              display: 'flex',
              gap: 16,
              alignItems: 'flex-start',
            }}
          >
            <div style={{ flexShrink: 0 }}>{it.icon}</div>
            <div>
              <h3 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 6px', color: 'var(--v3-text-primary)' }}>{it.title}</h3>
              <p style={{ fontSize: 14, lineHeight: 1.55, color: 'var(--v3-text-secondary)', margin: 0 }}>{it.body}</p>
            </div>
          </motion.div>
        ))}
      </div>
    </section>
  )
}
