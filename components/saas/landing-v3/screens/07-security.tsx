'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { useState } from 'react'

const fadeUp = { initial: { opacity: 0, y: 40 }, whileInView: { opacity: 1, y: 0 }, viewport: { once: true, margin: '-100px' } }

export function ScreenSecurity() {
  const [open, setOpen] = useState(false)

  return (
    <section id="security" className="landing-v3-section">
      <div style={{ maxWidth: 760, margin: '0 auto', textAlign: 'center' }}>
        <motion.h2
          {...fadeUp}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          className="landing-v3-h2 landing-v3-h2--serif"
        >
          Имена твоих учеников и их балансы. <em>Это твоё.</em>
        </motion.h2>

        <motion.p {...fadeUp} transition={{ duration: 0.7, delay: 0.1 }} className="landing-v3-body-editorial" style={{ marginTop: 40, marginLeft: 'auto', marginRight: 'auto' }}>
          Мы не передаём твои данные третьим лицам. Не показываем их в рекламе. Не отправляем
          в аналитические системы. На сайте есть один счётчик. Он считает клики по кнопкам,
          без имён, без email, без сумм.
        </motion.p>

        <motion.p {...fadeUp} transition={{ duration: 0.7, delay: 0.2 }} className="landing-v3-body-editorial" style={{ marginLeft: 'auto', marginRight: 'auto' }}>
          Согласия учеников на обработку персональных данных фиксируются по правилам 152-ФЗ.
          С штампом времени, версией документа, IP-адресом и user-agent'ом. Если когда-то понадобится
          показать налоговой или Роскомнадзору, вся история готова к выгрузке.
        </motion.p>

        <motion.div {...fadeUp} transition={{ duration: 0.6, delay: 0.3 }} style={{ marginTop: 32 }}>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 10,
              padding: '12px 20px',
              borderRadius: 999,
              background: 'transparent',
              border: '1px solid var(--v3-rule-strong)',
              color: 'var(--v3-text-secondary)',
              fontSize: 14,
              fontFamily: 'inherit',
              cursor: 'pointer',
              transition: 'background 200ms ease, color 200ms ease, border-color 200ms ease',
            }}
            aria-expanded={open}
            aria-controls="security-details"
          >
            <span>{open ? 'Скрыть технические подробности' : 'Технические подробности'}</span>
            <span
              style={{
                display: 'inline-block',
                transition: 'transform 200ms ease',
                transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
                fontSize: 12,
              }}
            >
              ▾
            </span>
          </button>

          <AnimatePresence initial={false}>
            {open ? (
              <motion.ul
                key="tech-details"
                id="security-details"
                initial={{ height: 0, opacity: 0, marginTop: 0 }}
                animate={{ height: 'auto', opacity: 1, marginTop: 24 }}
                exit={{ height: 0, opacity: 0, marginTop: 0 }}
                transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                style={{
                  overflow: 'hidden',
                  listStyle: 'none',
                  padding: 0,
                  margin: 0,
                  color: 'var(--v3-text-secondary)',
                  fontSize: 14,
                  lineHeight: 2,
                  textAlign: 'left',
                  maxWidth: 520,
                  marginLeft: 'auto',
                  marginRight: 'auto',
                }}
              >
                <li>· TLS на каждом соединении между тобой, нами и банком.</li>
                <li>· Пароли хранятся в виде bcrypt-хэшей. Никто, включая нас, не видит твой пароль.</li>
                <li>· Платёжные webhook'и подписаны HMAC. Никто не подделает «оплата пришла».</li>
                <li>· Сессии истекают через 7 дней. При выходе отзываются мгновенно.</li>
              </motion.ul>
            ) : null}
          </AnimatePresence>
        </motion.div>
      </div>
    </section>
  )
}
