'use client'

import { motion } from 'framer-motion'

const reveal = {
  initial: { opacity: 0, y: 28 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: '-120px' },
}

const BUBBLES = [
  { who: 'Маша', text: 'Можем перенести на четверг?', delay: 0.2 },
  { who: 'Мама Пети', text: 'А реквизиты для перевода ещё раз можно?', delay: 0.8 },
  { who: 'Аня', text: 'У меня вылетело из календаря, во сколько у нас?', delay: 1.4 },
  { who: 'Кирилл', text: 'Что было на прошлом уроке? Я забыл записать.', delay: 2.0 },
]

export function A02Morning() {
  return (
    <section className="v4-scene" id="morning">
      <div
        className="v4-scene__bg"
        style={{
          backgroundImage:
            'radial-gradient(circle at 20% 30%, rgba(232,168,144,0.04) 0%, transparent 40%), radial-gradient(circle at 80% 60%, rgba(200,120,120,0.04) 0%, transparent 40%)',
        }}
      />
      <div className="v4-scene__content" style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 56 }}>
        <div style={{ maxWidth: 880, marginInline: 'auto', textAlign: 'center' }}>
          <motion.h2 className="v4-h2 v4-h2--serif" {...reveal} transition={{ duration: 0.9 }}>
            Утро. <span className="v4-em-warm">Telegram. Excel. Блокнот.</span> Ещё Telegram.
          </motion.h2>
          <motion.p
            className="v4-lede"
            {...reveal}
            transition={{ duration: 0.9, delay: 0.15 }}
            style={{ marginTop: 24, marginInline: 'auto' }}
          >
            Ты открыла шесть вкладок ещё до того, как первый ученик сказал «привет».
          </motion.p>
        </div>

        <div
          style={{
            position: 'relative',
            maxWidth: 720,
            marginInline: 'auto',
            display: 'grid',
            gap: 12,
            paddingTop: 8,
          }}
        >
          {BUBBLES.map((b, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: i % 2 === 0 ? -30 : 30 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true, margin: '-100px' }}
              transition={{ duration: 0.6, delay: b.delay, ease: [0.16, 1, 0.3, 1] }}
              style={{
                alignSelf: i % 2 === 0 ? 'flex-start' : 'flex-end',
                maxWidth: '78%',
                background: i % 2 === 0 ? 'var(--v4-elevated)' : 'var(--v4-warm-surface)',
                border: '1px solid var(--v4-rule)',
                borderRadius: i % 2 === 0 ? '18px 18px 18px 4px' : '18px 18px 4px 18px',
                padding: '14px 18px',
                fontSize: 15,
                color: 'var(--v4-text-secondary)',
                lineHeight: 1.55,
              }}
            >
              <div style={{ fontSize: 11, color: 'var(--v4-text-muted)', marginBottom: 4, letterSpacing: '0.02em' }}>
                {b.who}
              </div>
              {b.text}
            </motion.div>
          ))}

          <motion.div
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true, margin: '-100px' }}
            transition={{ duration: 0.8, delay: 2.6 }}
            style={{
              marginTop: 28,
              textAlign: 'right',
              fontSize: 13,
              color: 'var(--v4-text-muted)',
              fontFamily: 'var(--v4-font-mono)',
            }}
          >
            47 непрочитанных к 11:00
          </motion.div>
        </div>
      </div>
    </section>
  )
}
