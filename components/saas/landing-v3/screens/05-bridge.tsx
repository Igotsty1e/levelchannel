'use client'

import { motion } from 'framer-motion'

const fadeUp = { initial: { opacity: 0, y: 40 }, whileInView: { opacity: 1, y: 0 }, viewport: { once: true, margin: '-100px' } }

export function ScreenBridge() {
  return (
    <section className="landing-v3-section">
      <div style={{ maxWidth: 980, margin: '0 auto', textAlign: 'center' }}>
        <motion.h2
          {...fadeUp}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          className="landing-v3-h2 landing-v3-h2--serif"
        >
          Один экран. <em>Знает всё.</em>
        </motion.h2>
        <motion.p
          {...fadeUp}
          transition={{ duration: 0.7, delay: 0.15 }}
          className="landing-v3-lede"
          style={{ marginTop: 24, marginLeft: 'auto', marginRight: 'auto' }}
        >
          Мы взяли только то, что репетитор реально открывает каждый день. Расписание, ученики,
          балансы, пакеты. Всё в одном кабинете — без рассыпанных Telegram-чатов, Excel-таблиц
          и шаблонов в Word.
        </motion.p>
        <motion.p
          {...fadeUp}
          transition={{ duration: 0.7, delay: 0.25 }}
          style={{ marginTop: 16, color: 'var(--v3-accent-end)', fontSize: 16, fontStyle: 'italic' }}
        >
          Сделан специально под частного репетитора. Без лишнего, с самым необходимым.
        </motion.p>
      </div>
    </section>
  )
}
