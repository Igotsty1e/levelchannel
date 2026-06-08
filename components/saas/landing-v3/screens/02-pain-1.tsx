'use client'

import { motion } from 'framer-motion'

const fadeUp = {
  initial: { opacity: 0, y: 28 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: '-100px' },
}

type Message = {
  who: string
  initials: string
  color: string
  at: string
  text: string
}

// Реальные реплики из утреннего родительского чата
const MESSAGES: Message[] = [
  { who: 'Мама Пети',     initials: 'МП', color: '#FE6E64', at: '08:12', text: 'А реквизиты для оплаты ещё раз можно?' },
  { who: 'Аня',           initials: 'А',  color: '#4FBBE8', at: '08:34', text: 'Можем перенести на четверг 18:00?' },
  { who: 'Маша',          initials: 'М',  color: '#FFA21F', at: '09:01', text: 'У меня вылетело из календаря, во сколько у нас?' },
  { who: 'Папа Кирилла',  initials: 'ПК', color: '#66CD5E', at: '09:18', text: 'Сегодня не сможем — Кирилл заболел.' },
  { who: 'Лена',          initials: 'Л',  color: '#C262E8', at: '09:42', text: 'Что было на прошлом уроке? Я не записала.' },
  { who: 'Мама Пети',     initials: 'МП', color: '#FE6E64', at: '09:55', text: 'Подскажите номер карты ещё раз 🙏' },
]

const TG_BUBBLE = '#212B37'
const TG_BG = '#0E1621'
const TG_HEADER = '#17212B'
const TG_TIME = '#6B7E8C'
const TG_TEXT = '#FFFFFF'
const TG_FONT = '-apple-system, "SF Pro Text", "Helvetica Neue", system-ui, sans-serif'

export function ScreenPain1() {
  return (
    <section id="pains" className="landing-v3-section" style={{ position: 'relative', overflow: 'hidden' }}>
      <div style={{ maxWidth: 1080, margin: '0 auto', display: 'grid', gap: 56 }}>
        <div style={{ maxWidth: 880, marginInline: 'auto', textAlign: 'center' }}>
          <motion.h2
            {...fadeUp}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
            className="landing-v3-h2 landing-v3-h2--serif"
          >
            До первого урока — уже <em>сорок сообщений.</em>
          </motion.h2>
          <motion.p
            {...fadeUp}
            transition={{ duration: 0.7, delay: 0.15 }}
            className="landing-v3-lede"
            style={{ marginTop: 24, marginInline: 'auto' }}
          >
            Перенесли, спросили реквизиты, ещё раз спросили реквизиты, забыли время, заболели, попросили домашку. Каждое утро по кругу.
          </motion.p>
        </div>

        {/* Telegram-style чат — все сообщения входящие, появляются по очереди */}
        <div
          style={{
            background: TG_BG,
            border: '1px solid rgba(255,255,255,0.05)',
            borderRadius: 16,
            maxWidth: 560,
            marginInline: 'auto',
            width: '100%',
            boxShadow: '0 40px 100px -32px rgba(0,0,0,0.65)',
            overflow: 'hidden',
            fontFamily: TG_FONT,
          }}
        >
          {/* Header чата */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '14px 16px',
              background: TG_HEADER,
              borderBottom: '1px solid rgba(255,255,255,0.04)',
            }}
          >
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: '50%',
                background: 'linear-gradient(135deg, #6DCAFF 0%, #4F9BE8 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'white',
                fontWeight: 500,
                fontSize: 14,
                letterSpacing: '0.02em',
              }}
              aria-hidden
            >
              УР
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: '#FFFFFF', fontSize: 15, fontWeight: 500 }}>Ученики и родители</div>
              <div style={{ color: '#6DCAFF', fontSize: 12, marginTop: 2 }}>
                47 непрочитанных сообщений
              </div>
            </div>
          </div>

          {/* Day separator */}
          <div style={{ display: 'flex', justifyContent: 'center', padding: '14px 0 8px' }}>
            <motion.span
              initial={{ opacity: 0, y: 6 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-60px' }}
              transition={{ duration: 0.4 }}
              style={{
                background: 'rgba(255,255,255,0.06)',
                color: '#A0AEC0',
                padding: '4px 12px',
                borderRadius: 14,
                fontSize: 11,
                letterSpacing: '0.02em',
              }}
            >
              понедельник, 8 июня
            </motion.span>
          </div>

          {/* Messages */}
          <div style={{ padding: '0 16px 20px', display: 'flex', flexDirection: 'column' }}>
            {MESSAGES.map((m, i) => {
              const prev = MESSAGES[i - 1]
              const isFirstInGroup = !prev || prev.who !== m.who
              return (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 14, scale: 0.96 }}
                  whileInView={{ opacity: 1, y: 0, scale: 1 }}
                  viewport={{ once: true, margin: '-60px' }}
                  transition={{ duration: 0.42, delay: 0.2 + i * 0.55, ease: [0.16, 1, 0.3, 1] }}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-end',
                    gap: 8,
                    marginTop: isFirstInGroup ? 10 : 2,
                  }}
                >
                  {/* Avatar — только у первого сообщения от автора */}
                  <div style={{ width: 32, flexShrink: 0, alignSelf: 'flex-end' }}>
                    {isFirstInGroup ? (
                      <div
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: '50%',
                          background: m.color,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: '#FFFFFF',
                          fontWeight: 500,
                          fontSize: 12,
                          letterSpacing: '0.02em',
                        }}
                        aria-hidden
                      >
                        {m.initials}
                      </div>
                    ) : null}
                  </div>

                  {/* Bubble */}
                  <div
                    style={{
                      background: TG_BUBBLE,
                      maxWidth: '78%',
                      padding: '6px 12px 6px 12px',
                      borderRadius: 14,
                      borderBottomLeftRadius: isFirstInGroup ? 4 : 14,
                      color: TG_TEXT,
                      fontSize: 14.5,
                      lineHeight: 1.35,
                      position: 'relative',
                    }}
                  >
                    {isFirstInGroup ? (
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 500,
                          color: m.color,
                          marginBottom: 2,
                          letterSpacing: '0.01em',
                        }}
                      >
                        {m.who}
                      </div>
                    ) : null}
                    <div style={{ paddingRight: 42 }}>{m.text}</div>
                    <span
                      style={{
                        position: 'absolute',
                        right: 10,
                        bottom: 5,
                        fontSize: 11,
                        color: TG_TIME,
                      }}
                    >
                      {m.at}
                    </span>
                  </div>
                </motion.div>
              )
            })}
          </div>
        </div>

        <motion.blockquote
          {...fadeUp}
          transition={{ duration: 0.7, delay: 0.3 }}
          className="landing-v3-pullquote"
          style={{ maxWidth: 700, marginInline: 'auto' }}
        >
          «Я устаю не от уроков. Я устаю от того, что между уроками.»
        </motion.blockquote>
      </div>
    </section>
  )
}
