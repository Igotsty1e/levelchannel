'use client'

import { motion } from 'framer-motion'

import { FrameImage } from '../../_shared/device-frame'

const reveal = {
  initial: { opacity: 0, y: 32 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: '-100px' },
}

type Module = {
  caption: string
  title: string
  body: string
  src: string
  alt: string
}

const MODULES: Module[] = [
  {
    caption: 'Расписание',
    title: 'Знает не только ты',
    body: 'Слот, который видит ученик и его родитель. Перенос — две секунды, без переписок. Напоминание в Telegram уходит автоматически.',
    src: '/assets/landing-v4/screens/feature-schedule.png',
    alt: 'Расписание учителя в кабинете',
  },
  {
    caption: 'Карточка ученика',
    title: 'Помнит за тебя',
    body: 'Имя, уровень, цели, заметки про слабые места. Что разбирали, что задал, что готовить сегодня — в одном месте, а не в голове.',
    src: '/assets/landing-v4/screens/feature-learner.png',
    alt: 'Карточка ученика',
  },
  {
    caption: 'Баланс',
    title: 'Деньги без неловкости',
    body: 'Ученик нажимает «Я оплатил», ты подтверждаешь одной кнопкой. Без скриншотов перевода в Telegram, без «сейчас пришлю реквизиты».',
    src: '/assets/landing-v4/screens/feature-balance.png',
    alt: 'Баланс по оплатам',
  },
  {
    caption: 'Месяц',
    title: 'Закрывается за вечер',
    body: 'Отчёт открыт. Сколько провёл, сколько получил, у кого пакет на исходе, и CSV для налоговой — на одной кнопке.',
    src: '/assets/landing-v4/screens/feature-monthly.png',
    alt: 'Месячный отчёт',
  },
]

export function A06Bento() {
  return (
    <section className="v4-scene" id="bento" style={{ minHeight: 'auto', padding: 'var(--v4-scene-py) var(--v4-scene-px)' }}>
      <div className="v4-scene__bg">
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundImage:
              'radial-gradient(circle at 1px 1px, rgba(255,255,255,0.04) 1px, transparent 0)',
            backgroundSize: '32px 32px',
            opacity: 0.5,
          }}
        />
      </div>
      <div className="v4-scene__content">
        <div style={{ textAlign: 'center', maxWidth: 760, marginInline: 'auto', marginBottom: 64 }}>
          <motion.h2 {...reveal} transition={{ duration: 0.9 }} className="v4-h2 v4-h2--serif">
            И ты вспомнила, <span className="v4-em-warm">что ты не администратор маленькой фирмы.</span>
          </motion.h2>
          <motion.p
            {...reveal}
            transition={{ duration: 0.9, delay: 0.15 }}
            className="v4-lede"
            style={{ marginTop: 24, marginInline: 'auto' }}
          >
            Ты педагог. У тебя четырнадцать учеников. И теперь ты знаешь имя каждого — без блокнота.
          </motion.p>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
            gap: 20,
            maxWidth: 1180,
            marginInline: 'auto',
          }}
        >
          {MODULES.map((m, i) => (
            <motion.div
              key={m.title}
              initial={{ opacity: 0, y: 40 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-80px' }}
              transition={{ duration: 0.7, delay: i * 0.12, ease: [0.16, 1, 0.3, 1] }}
              className="v4-card"
              style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
            >
              <div
                style={{
                  aspectRatio: '4 / 3',
                  background: 'linear-gradient(135deg, #16161A, #1A1818)',
                  overflow: 'hidden',
                  position: 'relative',
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
          ))}
        </div>
      </div>
    </section>
  )
}
