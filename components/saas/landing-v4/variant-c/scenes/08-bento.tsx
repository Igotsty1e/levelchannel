'use client'

import { motion } from 'framer-motion'

import { FrameImage } from '../../_shared/device-frame'

const reveal = {
  initial: { opacity: 0, y: 28 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: '-100px' },
}

const MODULES = [
  {
    caption: 'Расписание',
    title: 'Slot, который видит ученик',
    body: 'Слот появляется в твоём кабинете и в календаре ученика. Перенос — два клика, без переписок. Telegram-напоминание отправляется автоматически.',
    src: '/assets/landing-v4/screens/feature-schedule.png',
    alt: 'Расписание учителя в кабинете',
    span: 'wide',
  },
  {
    caption: 'Ученик',
    title: 'Карточка вместо блокнота',
    body: 'Имя, уровень, заметки, что было на прошлом уроке. Готовишься, открывая одну страницу.',
    src: '/assets/landing-v4/screens/feature-learner.png',
    alt: 'Карточка ученика',
    span: 'normal',
  },
  {
    caption: 'Деньги',
    title: 'СБП «Я оплатил»',
    body: 'Ученик переводит, нажимает кнопку — ты подтверждаешь одной. Без скриншотов перевода в Telegram.',
    src: '/assets/landing-v4/screens/feature-balance.png',
    alt: 'Балансы и СБП',
    span: 'normal',
  },
  {
    caption: 'Месяц',
    title: 'Закрывается за вечер',
    body: 'Сколько провёл, сколько получил, у кого пакет на исходе. CSV для налоговой — одной кнопкой.',
    src: '/assets/landing-v4/screens/feature-monthly.png',
    alt: 'Месячный отчёт',
    span: 'wide',
  },
]

export function C08Bento() {
  return (
    <section className="v4-scene" id="bento" style={{ minHeight: 'auto', padding: 'var(--v4-scene-py) var(--v4-scene-px)' }}>
      <div className="v4-scene__bg">
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundImage:
              'radial-gradient(circle at 1px 1px, rgba(255,255,255,0.045) 1px, transparent 0)',
            backgroundSize: '32px 32px',
            opacity: 0.5,
          }}
        />
      </div>
      <div className="v4-scene__content">
        <div style={{ textAlign: 'center', maxWidth: 760, marginInline: 'auto', marginBottom: 56 }}>
          <motion.div {...reveal} transition={{ duration: 0.7 }} className="v4-eyebrow" style={{ marginBottom: 20 }}>
            Что внутри
          </motion.div>
          <motion.h2 {...reveal} transition={{ duration: 0.9, delay: 0.1 }} className="v4-h2 v4-h2--serif">
            Если ты дочитала до сюда — <span className="v4-em-warm">вот точное содержание.</span>
          </motion.h2>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(12, 1fr)',
            gap: 20,
            maxWidth: 1180,
            marginInline: 'auto',
          }}
        >
          {MODULES.map((m, i) => {
            const cols = m.span === 'wide' ? 7 : 5
            return (
              <motion.div
                key={m.title}
                initial={{ opacity: 0, y: 40 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-80px' }}
                transition={{ duration: 0.7, delay: i * 0.1, ease: [0.16, 1, 0.3, 1] }}
                className="v4-card"
                style={{
                  gridColumn: `span 12`,
                  padding: 0,
                  overflow: 'hidden',
                  display: 'flex',
                  flexDirection: 'column',
                }}
                data-cols={cols}
              >
                <div
                  style={{
                    aspectRatio: '16 / 9',
                    background: 'linear-gradient(135deg, #16161A, #1A1818)',
                    overflow: 'hidden',
                    borderBottom: '1px solid var(--v4-rule)',
                  }}
                >
                  <FrameImage src={m.src} alt={m.alt} />
                </div>
                <div style={{ padding: '24px 28px 28px' }}>
                  <div
                    style={{
                      fontSize: 11,
                      letterSpacing: '0.16em',
                      textTransform: 'uppercase',
                      color: 'var(--v4-text-muted)',
                      marginBottom: 10,
                    }}
                  >
                    {m.caption}
                  </div>
                  <h3 className="v4-h3" style={{ marginBottom: 10 }}>
                    {m.title}
                  </h3>
                  <p className="v4-body" style={{ fontSize: 14, lineHeight: 1.6 }}>
                    {m.body}
                  </p>
                </div>
              </motion.div>
            )
          })}
        </div>
      </div>

      <style>{`
        @media (min-width: 900px) {
          #bento .v4-card[data-cols="7"] { grid-column: span 7; }
          #bento .v4-card[data-cols="5"] { grid-column: span 5; }
        }
      `}</style>
    </section>
  )
}
