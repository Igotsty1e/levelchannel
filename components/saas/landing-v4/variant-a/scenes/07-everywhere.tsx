'use client'

import { motion } from 'framer-motion'

import { Spotlight } from '@/components/ui/aceternity/spotlight'

import { FrameImage, LaptopFrame, PhoneFrame } from '../../_shared/device-frame'

const reveal = {
  initial: { opacity: 0, y: 28 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: '-100px' },
}

const ASSURANCES = [
  {
    title: 'Любой браузер',
    body: 'Chrome, Safari, Firefox, Edge. На ноуте, на планшете, на телефоне. Без App Store и без обновлений.',
  },
  {
    title: 'Данные у нас',
    body: 'Не на твоём устройстве. Сломалось — открываешь с другого, всё на месте: ученики, расписание, баланс.',
  },
  {
    title: 'Ничего не пропадёт',
    body: 'Резервные копии каждый час. История изменений по каждому ученику. Контакты не теряются.',
  },
]

export function A07Everywhere() {
  return (
    <section className="v4-scene" id="everywhere">
      <div className="v4-scene__bg">
        <Spotlight className="-top-40 left-0 md:left-60 md:-top-20" fill="rgba(232,168,144,0.18)" />
      </div>
      <div className="v4-scene__content" style={{ maxWidth: 1180 }}>
        <div style={{ textAlign: 'center', maxWidth: 760, marginInline: 'auto', marginBottom: 64 }}>
          <motion.div {...reveal} transition={{ duration: 0.7 }} className="v4-eyebrow" style={{ marginBottom: 20 }}>
            Где угодно
          </motion.div>
          <motion.h2 {...reveal} transition={{ duration: 0.9, delay: 0.1 }} className="v4-h2 v4-h2--serif">
            Открывается где угодно. <span className="v4-em-warm">Ничего не надо ставить.</span>
          </motion.h2>
          <motion.p
            {...reveal}
            transition={{ duration: 0.9, delay: 0.2 }}
            className="v4-lede"
            style={{ marginTop: 24, marginInline: 'auto' }}
          >
            Утром на кухне с телефоном. Вечером — с ноутбуком. В пятницу — с планшетом на встрече. Везде один и тот же кабинет, везде те же ученики.
          </motion.p>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 60 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1], delay: 0.3 }}
          style={{
            position: 'relative',
            maxWidth: 1080,
            marginInline: 'auto',
            marginBottom: 64,
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'center',
            gap: 0,
          }}
        >
          <div style={{ flex: '0 1 820px', maxWidth: '78%' }}>
            <LaptopFrame tilt={3}>
              <FrameImage
                src="/assets/landing-v4/screens/teacher-dashboard.png"
                alt="Кабинет учителя на ноутбуке"
              />
            </LaptopFrame>
          </div>
          <div
            style={{
              flex: '0 0 220px',
              marginLeft: -90,
              marginBottom: 12,
              zIndex: 2,
            }}
          >
            <PhoneFrame tilt={-2}>
              <FrameImage
                src="/assets/landing-v4/screens/learner-mobile.png"
                alt="Карточка ученика на телефоне"
              />
            </PhoneFrame>
          </div>
        </motion.div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            gap: 16,
            maxWidth: 980,
            marginInline: 'auto',
          }}
        >
          {ASSURANCES.map((a, i) => (
            <motion.div
              key={a.title}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-80px' }}
              transition={{ duration: 0.7, delay: 0.45 + i * 0.08 }}
              style={{ padding: '8px 0' }}
            >
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: 'var(--v4-accent-end)',
                  marginBottom: 8,
                  letterSpacing: '-0.005em',
                }}
              >
                {a.title}
              </div>
              <p className="v4-body" style={{ fontSize: 13, lineHeight: 1.6 }}>
                {a.body}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}
