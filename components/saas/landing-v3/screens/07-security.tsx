'use client'

import { motion } from 'framer-motion'

const reveal = {
  initial: { opacity: 0, y: 28 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: '-100px' },
}

type Guarantee = {
  n: string
  title: string
  body: string
}

const GUARANTEES: Guarantee[] = [
  {
    n: '01',
    title: 'Серверы в России',
    body: 'Первичная запись и хранение — на территории РФ, как требует ч. 5 ст. 18 152-ФЗ.',
  },
  {
    n: '02',
    title: 'Пароли никто не видит',
    body: 'Хранятся bcrypt-хэшем, cost=12. Даже мы не знаем твой пароль и не можем его узнать.',
  },
  {
    n: '03',
    title: 'Платежи подписаны HMAC',
    body: 'Webhook'+'\u200B'+'и от банка подписываются HMAC-SHA256. Подделать «оплата пришла» извне невозможно.',
  },
  {
    n: '04',
    title: 'Ноль рекламных трекеров',
    body: 'Никаких Google Analytics, Метрики, Hotjar и пикселей. Один внутренний счётчик кликов без имён и сумм.',
  },
  {
    n: '05',
    title: 'TLS на всех соединениях',
    body: 'Между тобой, нами и банком — только шифрованные соединения. В транзите никто посторонний не подсмотрит.',
  },
  {
    n: '06',
    title: 'Согласия — append-only',
    body: 'Каждое согласие ученика — отдельная запись с датой, версией документа, IP и устройством. Перезаписать историю нельзя.',
  },
]

export function ScreenSecurity() {
  return (
    <section id="security" className="landing-v3-section" style={{ position: 'relative', overflow: 'hidden' }}>
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'radial-gradient(ellipse 60% 50% at 80% 30%, rgba(232,168,144,0.07) 0%, transparent 60%)',
        }}
      />

      <div style={{ maxWidth: 1180, margin: '0 auto', position: 'relative' }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr',
            gap: 48,
            alignItems: 'start',
          }}
          className="security-grid"
        >
          {/* Left — заголовок + лида + штамп */}
          <div style={{ display: 'grid', gap: 32 }}>
            <motion.h2 {...reveal} transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }} className="landing-v3-h2 landing-v3-h2--serif">
              Имена и балансы — <em>это твоё.</em>
            </motion.h2>

            <motion.p {...reveal} transition={{ duration: 0.8, delay: 0.1 }} className="landing-v3-lede" style={{ margin: 0 }}>
              Мы не продаём данные и не пускаем их в рекламные сети. А 152-ФЗ берём на себя — серверы, согласия, журналы. Тебе остаётся учить.
            </motion.p>

            {/* Печать-stamp */}
            <motion.div
              initial={{ opacity: 0, scale: 0.7, rotate: -10 }}
              whileInView={{ opacity: 1, scale: 1, rotate: -6 }}
              viewport={{ once: true, margin: '-100px' }}
              transition={{ duration: 0.9, delay: 0.3, ease: [0.16, 1, 0.3, 1] }}
              style={{
                width: 220,
                height: 220,
                borderRadius: '50%',
                border: '3px double rgba(232, 168, 144, 0.5)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                position: 'relative',
                fontFamily: 'var(--v3-font-serif, Charter, Georgia, serif)',
                color: 'rgba(232, 168, 144, 0.85)',
                textAlign: 'center',
                marginTop: 8,
                boxShadow: '0 0 0 1px rgba(232,168,144,0.08), 0 20px 40px -20px rgba(232,168,144,0.25)',
              }}
            >
              <svg
                viewBox="0 0 220 220"
                width="220"
                height="220"
                style={{ position: 'absolute', inset: 0 }}
                aria-hidden
              >
                <defs>
                  <path id="stamp-arc" d="M 110,110 m -86,0 a 86,86 0 1,1 172,0 a 86,86 0 1,1 -172,0" fill="none" />
                </defs>
                <text style={{ fontSize: 11, letterSpacing: '0.32em', fill: 'rgba(232,168,144,0.55)' }}>
                  <textPath href="#stamp-arc" startOffset="0%">
                    LEVELCHANNEL · ДАННЫЕ В РФ · 152-ФЗ · LEVELCHANNEL ·
                  </textPath>
                </text>
              </svg>
              <div style={{ position: 'relative', zIndex: 1, lineHeight: 1.2 }}>
                <div style={{ fontSize: 11, letterSpacing: '0.22em', color: 'rgba(232,168,144,0.55)' }}>
                  СООТВЕТСТВУЕТ
                </div>
                <div style={{ fontSize: 32, marginTop: 6, fontWeight: 500 }}>152-ФЗ</div>
                <div
                  style={{
                    fontSize: 10,
                    marginTop: 8,
                    color: 'rgba(232,168,144,0.5)',
                    letterSpacing: '0.12em',
                  }}
                >
                  с 2025 года
                </div>
              </div>
            </motion.div>
          </div>

          {/* Right — vertical timeline гарантий */}
          <div style={{ position: 'relative' }}>
            <div
              aria-hidden
              style={{
                position: 'absolute',
                left: 16,
                top: 8,
                bottom: 60,
                width: 1,
                background:
                  'linear-gradient(180deg, transparent 0%, rgba(232,168,144,0.35) 10%, rgba(232,168,144,0.25) 90%, transparent 100%)',
              }}
            />
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 28 }}>
              {GUARANTEES.map((g, i) => (
                <motion.li
                  key={g.n}
                  initial={{ opacity: 0, x: -16 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true, margin: '-80px' }}
                  transition={{ duration: 0.5, delay: 0.15 + i * 0.08, ease: [0.16, 1, 0.3, 1] }}
                  style={{ position: 'relative', paddingLeft: 56 }}
                >
                  <div
                    style={{
                      position: 'absolute',
                      left: 4,
                      top: 2,
                      width: 26,
                      height: 26,
                      borderRadius: '50%',
                      background: 'var(--v3-bg)',
                      border: '1px solid rgba(232,168,144,0.45)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 10,
                      color: 'var(--v3-accent-end)',
                      letterSpacing: '0.05em',
                      fontFamily: 'JetBrains Mono, monospace',
                    }}
                  >
                    {g.n}
                  </div>
                  <h3 style={{ fontSize: 17, fontWeight: 600, margin: 0, color: 'var(--v3-text-primary)' }}>
                    {g.title}
                  </h3>
                  <p style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--v3-text-secondary)', margin: '6px 0 0' }}>
                    {g.body}
                  </p>
                </motion.li>
              ))}
            </ul>

            <motion.div
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true, margin: '-80px' }}
              transition={{ duration: 0.6, delay: 0.7 }}
              style={{
                marginTop: 36,
                paddingLeft: 56,
                fontSize: 13,
                color: 'var(--v3-text-muted)',
              }}
            >
              Подробно про 152-ФЗ, обработку и согласия —{' '}
              <a
                href="/saas/learn/security"
                className="landing-v3-link"
                style={{ color: 'var(--v3-accent-end)' }}
              >
                как мы это делаем
              </a>
              .
            </motion.div>
          </div>
        </div>
      </div>

      <style>{`
        @media (min-width: 960px) {
          .security-grid {
            grid-template-columns: 1fr 1fr !important;
            gap: 80px !important;
          }
        }
      `}</style>
    </section>
  )
}
