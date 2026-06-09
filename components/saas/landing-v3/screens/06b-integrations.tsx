'use client'

import { motion } from 'framer-motion'

import { track } from '@/lib/analytics/track'

const fadeUp = {
  initial: { opacity: 0, y: 30 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: '-80px' },
}

type IntegrationTarget = 'google_calendar' | 'telegram' | 'email' | 'digest'

type Integration = {
  brand: string
  what: string
  body: string
  target: IntegrationTarget
}

const INTEGRATIONS: Integration[] = [
  {
    brand: 'Google Calendar',
    what: 'Слот → событие',
    body: 'Создал слот в кабинете — он сразу появляется в Google-календаре у тебя и у ученика. Без переноса вручную.',
    target: 'google_calendar',
  },
  {
    brand: 'Telegram',
    what: 'Напоминание ученику',
    body: 'За час до занятия ученик получает напоминание в Telegram. «Забыл, что у нас сегодня» исчезает.',
    target: 'telegram',
  },
  {
    brand: 'E-mail',
    what: 'Подтверждения и переносы',
    body: 'Подтверждение записи, перенос, отмена — уходят на почту ученику и родителю автоматически. Не нужно копировать-вставлять.',
    target: 'email',
  },
  {
    brand: 'Дайджест',
    what: 'Утром одной строкой',
    body: 'Что произошло за день: кто пришёл, кто перенёс, у кого истёк пакет. В кабинете и на почту. Без рысканья по экранам.',
    target: 'digest',
  },
]

export function ScreenIntegrations() {
  return (
    <section id="integrations" className="landing-v3-section">
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 64, maxWidth: 760, marginInline: 'auto' }}>
          <motion.h2
            {...fadeUp}
            transition={{ duration: 0.7 }}
            className="landing-v3-h2 landing-v3-h2--serif"
          >
            Работает с тем, <em>чем ты уже пользуешься.</em>
          </motion.h2>
          <motion.p {...fadeUp} transition={{ duration: 0.7, delay: 0.1 }} className="landing-v3-lede" style={{ margin: '20px auto 0' }}>
            Не «ещё один новый сервис». Подключается к Google Calendar и Telegram, в которых ты и так живёшь.
          </motion.p>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            gap: 0,
            maxWidth: 1080,
            marginInline: 'auto',
            border: '1px solid var(--v3-rule)',
            borderRadius: 16,
            overflow: 'hidden',
            background: 'var(--v3-surface)',
          }}
        >
          {INTEGRATIONS.map((it, idx) => (
            <motion.div
              key={it.brand}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-80px' }}
              transition={{ duration: 0.6, delay: idx * 0.08 }}
              onClick={() => track('integrations_link_clicked', { target: it.target })}
              style={{
                padding: '28px 28px 28px',
                borderRight: '1px solid var(--v3-rule)',
                borderBottom: '1px solid var(--v3-rule)',
                position: 'relative',
                cursor: 'pointer',
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  letterSpacing: '0.18em',
                  textTransform: 'uppercase',
                  color: 'var(--v3-text-muted)',
                  marginBottom: 12,
                }}
              >
                {it.brand}
              </div>
              <h3
                style={{
                  fontSize: 18,
                  fontWeight: 600,
                  margin: '0 0 12px',
                  color: 'var(--v3-text-primary)',
                  lineHeight: 1.35,
                }}
              >
                {it.what}
              </h3>
              <p style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--v3-text-secondary)', margin: 0 }}>
                {it.body}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}
