'use client'

import Image from 'next/image'
import { motion } from 'framer-motion'

const fadeUp = { initial: { opacity: 0, y: 28 }, whileInView: { opacity: 1, y: 0 }, viewport: { once: true, margin: '-80px' } }

type Job = {
  pain: string
  promise: string
  src: string
  alt: string
  /** где сфокусировать кроп фонового скрина */
  objectPosition: string
}

const JOBS: Job[] = [
  {
    pain: '«Можем перенести? А во сколько? А я тогда занят…»',
    promise: 'Перенос занятия в два клика. Календарь обновится самостоятельно.',
    src: '/assets/landing-v3/screens/feature-schedule.png',
    alt: 'Расписание — неделя',
    objectPosition: '50% 30%',
  },
  {
    pain: '«Кто за что заплатил в феврале?»',
    promise: 'Балансы, пакеты и оплаты — на одном экране.',
    src: '/assets/landing-v3/screens/feature-balance.png',
    alt: 'Сводка по балансам и оплатам',
    objectPosition: '50% 18%',
  },
  {
    pain: '«Сколько Маша уже потратила из пакета?»',
    promise: 'Пакет уменьшается сам после каждого проведённого занятия.',
    src: '/assets/landing-v3/screens/feature-methods.png',
    alt: 'Пакеты и тарифы',
    objectPosition: '50% 40%',
  },
]

export function ScreenFeatures() {
  return (
    <section id="features" className="landing-v3-section">
      <div style={{ maxWidth: 920, margin: '0 auto 48px', textAlign: 'center' }}>
        <motion.h2
          {...fadeUp}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          className="landing-v3-h2 landing-v3-h2--serif"
        >
          Закроет <em>за тебя.</em>
        </motion.h2>
        <motion.p
          {...fadeUp}
          transition={{ duration: 0.7, delay: 0.1 }}
          className="landing-v3-lede"
          style={{ marginTop: 20, marginLeft: 'auto', marginRight: 'auto' }}
        >
          Не «ещё один софт, чтобы освоить». А работа, которая съедает время между уроками.
        </motion.p>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(1, 1fr)',
          gap: 16,
          maxWidth: 1080,
          margin: '0 auto',
        }}
        className="landing-v3-jobs"
      >
        {JOBS.map((j, idx) => (
          <motion.div
            key={j.pain}
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-60px' }}
            transition={{ duration: 0.6, delay: idx * 0.08, ease: [0.16, 1, 0.3, 1] }}
            className="landing-v3-card landing-v3-job-cell"
            style={{
              padding: 0,
              overflow: 'hidden',
            }}
          >
            {/* Маленький, но видимый кроп скриншота */}
            <div
              className="landing-v3-job-shot"
              style={{
                position: 'relative',
                background:
                  'radial-gradient(110% 90% at 50% 0%, rgba(232,168,144,0.10) 0%, transparent 55%), linear-gradient(180deg, #131316, #0e0e10)',
                overflow: 'hidden',
                borderBottom: '1px solid var(--v3-rule)',
              }}
            >
              <Image
                src={j.src}
                alt={j.alt}
                fill
                sizes="(max-width: 760px) 100vw, 240px"
                style={{
                  objectFit: 'cover',
                  objectPosition: j.objectPosition,
                }}
              />
              <div
                aria-hidden
                style={{
                  position: 'absolute',
                  inset: 0,
                  background:
                    'linear-gradient(180deg, rgba(232,168,144,0.03) 0%, transparent 30%), linear-gradient(180deg, transparent 70%, rgba(11,11,12,0.55) 100%)',
                  pointerEvents: 'none',
                }}
              />
            </div>

            {/* Текст */}
            <div
              className="landing-v3-job-text"
              style={{
                padding: '20px 24px 22px',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                gap: 8,
              }}
            >
              <div
                style={{
                  fontSize: 14,
                  lineHeight: 1.4,
                  color: 'var(--v3-text-muted)',
                  fontStyle: 'italic',
                }}
              >
                {j.pain}
              </div>
              <h3
                style={{
                  fontSize: 16,
                  lineHeight: 1.45,
                  color: 'var(--v3-text-primary)',
                  fontWeight: 500,
                  margin: 0,
                }}
              >
                {j.promise}
              </h3>
            </div>
          </motion.div>
        ))}
      </div>

      <style>{`
        .landing-v3-jobs {
          max-width: 760px;
          margin-left: auto;
          margin-right: auto;
        }
        .landing-v3-job-cell {
          display: grid;
          grid-template-columns: 1fr;
          transition: transform 320ms cubic-bezier(0.16, 1, 0.3, 1), border-color 200ms;
        }
        .landing-v3-job-cell:hover { transform: translateY(-3px); border-color: var(--v3-rule-strong); }
        .landing-v3-job-shot { height: 140px; }

        @media (min-width: 760px) {
          .landing-v3-job-cell {
            grid-template-columns: 240px 1fr;
            min-height: 160px;
          }
          .landing-v3-job-shot {
            height: auto;
            border-bottom: none !important;
            border-right: 1px solid var(--v3-rule);
          }
        }
      `}</style>
    </section>
  )
}
