'use client'

import Image from 'next/image'
import { motion } from 'framer-motion'

import { Spotlight } from '@/components/ui/aceternity'
import { track } from '@/lib/analytics/track'

const reveal = {
  initial: { opacity: 0, y: 28 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: '-100px' },
}


// ─── Realistic laptop frame with shadows + highlights ───
function Laptop({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ position: 'relative', width: '100%', maxWidth: 720 }}>
      {/* Reflection — soft glow under device */}
      <div
        style={{
          position: 'absolute',
          left: '8%',
          right: '8%',
          bottom: -30,
          height: 80,
          background: 'radial-gradient(ellipse at center, rgba(232,168,144,0.22) 0%, transparent 60%)',
          filter: 'blur(28px)',
          zIndex: 0,
          pointerEvents: 'none',
        }}
      />
      {/* Laptop body */}
      <div
        style={{
          position: 'relative',
          width: '100%',
          aspectRatio: '16 / 10',
          background: 'linear-gradient(180deg, #2a2a2f 0%, #1c1c20 60%, #0e0e10 100%)',
          borderRadius: '14px 14px 4px 4px',
          padding: '20px 18px 14px',
          border: '1px solid rgba(255,255,255,0.06)',
          boxShadow: [
            'inset 0 1px 0 rgba(255,255,255,0.12)',
            'inset 0 -1px 0 rgba(0,0,0,0.4)',
            '0 1px 0 rgba(255,255,255,0.04)',
            '0 30px 60px -20px rgba(0,0,0,0.55)',
            '0 60px 100px -30px rgba(0,0,0,0.45)',
            '0 100px 160px -40px rgba(232,168,144,0.08)',
          ].join(', '),
          zIndex: 1,
        }}
      >
        {/* Top highlight bezel */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: '14%',
            right: '14%',
            height: 1,
            background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.18), transparent)',
            borderRadius: 1,
          }}
        />
        {/* Notch */}
        <div
          style={{
            position: 'absolute',
            top: 6,
            left: '50%',
            transform: 'translateX(-50%)',
            width: 70,
            height: 8,
            background: '#0a0a0c',
            borderRadius: '0 0 8px 8px',
          }}
        />
        {/* Screen */}
        <div
          style={{
            position: 'relative',
            width: '100%',
            height: '100%',
            background: '#0B0B0C',
            borderRadius: 8,
            overflow: 'hidden',
            boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.6)',
          }}
        >
          {children}
          {/* Screen glare — top-left to bottom-right diagonal */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background:
                'linear-gradient(120deg, rgba(255,255,255,0.04) 0%, transparent 25%, transparent 75%, rgba(232,168,144,0.04) 100%)',
              pointerEvents: 'none',
            }}
          />
        </div>
      </div>
      {/* Hinge */}
      <div
        style={{
          position: 'relative',
          marginTop: 0,
          height: 6,
          width: '102%',
          marginLeft: '-1%',
          background: 'linear-gradient(180deg, #0e0e10 0%, #18181a 100%)',
          borderRadius: '0 0 8px 8px',
          boxShadow: '0 14px 30px -10px rgba(0,0,0,0.6)',
          zIndex: 0,
        }}
      />
    </div>
  )
}

// ─── iPhone 11 frame (с нотчем, не Dynamic Island) ───
function Phone({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ position: 'relative', width: '100%' }}>
      {/* Floor shadow */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          left: '8%',
          right: '8%',
          bottom: -22,
          height: 50,
          background: 'radial-gradient(ellipse at center, rgba(0,0,0,0.55) 0%, transparent 65%)',
          filter: 'blur(28px)',
          zIndex: 0,
        }}
      />
      {/* Black aluminum body — colors как у компа */}
      <div
        style={{
          position: 'relative',
          width: '100%',
          aspectRatio: '9 / 19.5',
          background:
            'linear-gradient(180deg, #2a2a2f 0%, #1c1c20 60%, #0e0e10 100%)',
          borderRadius: 44,
          padding: 8,
          boxSizing: 'border-box',
          boxShadow: [
            'inset 0 0 0 1px rgba(255,255,255,0.10)',
            'inset 0 1px 0 rgba(255,255,255,0.18)',
            'inset 0 -1px 0 rgba(0,0,0,0.5)',
            'inset 2px 0 0 rgba(255,255,255,0.05)',
            'inset -2px 0 0 rgba(0,0,0,0.35)',
            '0 30px 70px -18px rgba(0,0,0,0.6)',
            '0 60px 110px -30px rgba(0,0,0,0.4)',
          ].join(', '),
          zIndex: 2,
        }}
      >
        {/* Volume up + Volume down LEFT (iPhone 11 — no action button) */}
        <div style={{ position: 'absolute', left: -4, top: '17%', width: 5, height: '7%', background: 'linear-gradient(90deg, #0a0a0c 0%, #2e2e33 50%, #0a0a0c 100%)', borderRadius: '2px 0 0 2px' }} />
        <div style={{ position: 'absolute', left: -4, top: '26%', width: 5, height: '7%', background: 'linear-gradient(90deg, #0a0a0c 0%, #2e2e33 50%, #0a0a0c 100%)', borderRadius: '2px 0 0 2px' }} />
        {/* Mute switch LEFT — самая верхняя */}
        <div style={{ position: 'absolute', left: -4, top: '11%', width: 5, height: '3.5%', background: 'linear-gradient(90deg, #0a0a0c 0%, #2e2e33 50%, #0a0a0c 100%)', borderRadius: '2px 0 0 2px' }} />
        {/* Power button RIGHT — opposite volume cluster */}
        <div style={{ position: 'absolute', right: -4, top: '20%', width: 5, height: '12%', background: 'linear-gradient(270deg, #0a0a0c 0%, #2e2e33 50%, #0a0a0c 100%)', borderRadius: '0 2px 2px 0' }} />

        {/* Screen + inner bezel ring */}
        <div
          style={{
            position: 'relative',
            width: '100%',
            height: '100%',
            background: '#000',
            borderRadius: 36,
            overflow: 'hidden',
            boxShadow: 'inset 0 0 0 1.5px #050505, inset 0 0 0 2.5px rgba(255,255,255,0.06)',
          }}
        >
          {/* Image — fills full screen incl real iOS status bar from screenshot */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              overflow: 'hidden',
              zIndex: 1,
            }}
          >
            {children}
          </div>

          {/* Notch (iPhone 11) — прямоугольный с закруглённым низом */}
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: '50%',
              transform: 'translateX(-50%)',
              width: '52%',
              height: '3.4%',
              background: '#000',
              borderRadius: '0 0 18px 18px',
              zIndex: 4,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6%',
              padding: '0 14%',
            }}
            aria-hidden
          >
            {/* Earpiece speaker grille */}
            <div
              style={{
                width: '40%',
                height: '14%',
                background: '#0a0a0c',
                borderRadius: 999,
                boxShadow: 'inset 0 0 0 0.5px rgba(255,255,255,0.04)',
              }}
            />
            {/* Camera lens dot */}
            <div
              style={{
                width: '10%',
                aspectRatio: '1 / 1',
                borderRadius: '50%',
                background: 'radial-gradient(circle at 35% 35%, #2a2c34 0%, #050507 70%)',
                boxShadow: 'inset 0 0 0 0.5px rgba(80,100,140,0.35)',
              }}
            />
          </div>

          {/* Subtle screen glare */}
          <div
            aria-hidden
            style={{
              position: 'absolute',
              inset: 0,
              background:
                'linear-gradient(135deg, rgba(255,255,255,0.06) 0%, transparent 24%, transparent 78%, rgba(255,255,255,0.04) 100%)',
              pointerEvents: 'none',
              zIndex: 5,
            }}
          />
        </div>
      </div>
    </div>
  )
}

const ASSURANCES = [
  {
    title: 'Любой браузер',
    body: 'Chrome, Safari, Firefox, Edge. App Store не нужен — это сайт, у которого есть кабинет.',
  },
  {
    title: 'Данные не на телефоне',
    body: 'Они у нас. Уронил телефон — открываешь с ноута, всё на месте.',
  },
  {
    title: 'Ничего не пропадёт',
    body: 'Бэкапы каждый час, история изменений по каждой строке. Ничего не потеряется в принципе.',
  },
]

export function ScreenMultiplatform() {
  return (
    <section id="multiplatform" className="landing-v3-section" style={{ position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0 }}>
        <Spotlight className="-top-40 left-0 md:left-60 md:-top-20" fill="rgba(232,168,144,0.18)" />
      </div>

      <div style={{ position: 'relative', zIndex: 1 }}>
        <div style={{ maxWidth: 880, margin: '0 auto', textAlign: 'center' }}>
          <motion.h2
            {...reveal}
            transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
            className="landing-v3-h2 landing-v3-h2--serif"
          >
            Без скачиваний и установок. <em>Открывается в браузере.</em>
          </motion.h2>
          <motion.p
            {...reveal}
            transition={{ duration: 0.9, delay: 0.15 }}
            className="landing-v3-lede"
            style={{ marginTop: 24, marginInline: 'auto' }}
          >
            Утром с телефона на кухне. Вечером — с ноутбука. В пятницу — с планшета на встрече. Один кабинет, те же ученики, тот же баланс.
          </motion.p>
        </div>

        {/* Device composition */}
        <motion.div
          initial={{ opacity: 0, y: 80 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          onViewportEnter={() => track('multiplatform_visible', {})}
          transition={{ duration: 1.4, ease: [0.16, 1, 0.3, 1], delay: 0.3 }}
          className="landing-v3-mp-stage"
          style={{
            position: 'relative',
            maxWidth: 1080,
            margin: '80px auto 80px',
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'center',
            gap: 0,
            paddingInline: 24,
          }}
        >
          {/* Laptop */}
          <div
            className="landing-v3-mp-laptop"
            style={{
              flex: '0 1 720px',
              maxWidth: '78%',
              transform: 'perspective(2200px) rotateX(4deg) rotateY(-2deg)',
              transformStyle: 'preserve-3d',
            }}
          >
            <Laptop>
              <Image
                src="/assets/landing-v3/screens/teacher-dashboard.png"
                alt="Кабинет учителя на ноутбуке"
                fill
                sizes="(max-width: 720px) 92vw, 720px"
                priority
                style={{ objectFit: 'cover', objectPosition: 'top center' }}
              />
            </Laptop>
          </div>
          {/* Phone — overlapping laptop bottom-right, slight tilt as in cron.com */}
          <div
            className="landing-v3-mp-phone"
            style={{
              flex: '0 0 220px',
              marginLeft: -60,
              marginBottom: 14,
              zIndex: 5,
              transform: 'perspective(1600px) rotateY(-7deg) rotateX(1deg)',
              transformOrigin: 'center center',
            }}
          >
            <Phone>
              <Image
                src="/assets/landing-v3/screens/teacher-mobile-cabinet.jpeg"
                alt="Кабинет учителя на мобильном"
                fill
                sizes="(max-width: 720px) 60vw, 220px"
                style={{ objectFit: 'cover', objectPosition: 'top center' }}
              />
            </Phone>
          </div>
        </motion.div>

        {/* 3 trust pills */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            gap: 16,
            maxWidth: 980,
            margin: '0 auto',
          }}
        >
          {ASSURANCES.map((a, i) => (
            <motion.div
              key={a.title}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-80px' }}
              transition={{ duration: 0.7, delay: 0.5 + i * 0.08 }}
              style={{ padding: 4 }}
            >
              <div
                style={{
                  fontSize: 15,
                  fontWeight: 600,
                  color: 'var(--v3-accent-end)',
                  marginBottom: 8,
                  letterSpacing: '-0.005em',
                }}
              >
                {a.title}
              </div>
              <p style={{ fontSize: 13, color: 'var(--v3-text-secondary)', lineHeight: 1.6, margin: 0 }}>{a.body}</p>
            </motion.div>
          ))}
        </div>
      </div>

      <style>{`
        @media (max-width: 760px) {
          .landing-v3-mp-stage {
            flex-direction: column !important;
            align-items: center !important;
            gap: 56px !important;
            padding-inline: 16px !important;
          }
          .landing-v3-mp-laptop {
            flex: none !important;
            width: 92% !important;
            max-width: 92% !important;
            transform: none !important;
          }
          .landing-v3-mp-phone {
            flex: none !important;
            width: 56% !important;
            max-width: 240px !important;
            margin-left: 0 !important;
            margin-bottom: 0 !important;
            transform: perspective(1600px) rotateY(-4deg) rotateX(1deg) !important;
          }
        }
      `}</style>
    </section>
  )
}
