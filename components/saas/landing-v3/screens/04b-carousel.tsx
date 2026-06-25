'use client'

import Image from 'next/image'
import { useEffect, useState, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

type Slide = {
  caption: string
  desktop: string
  mobile: string
  alt: string
}

const SLIDES: Slide[] = [
  {
    caption: 'Главная — все ученики, кто оплатил, кто должен',
    desktop: '/assets/landing-v3/screens/teacher-dashboard.png',
    mobile: '/assets/landing-v3/screens/teacher-mobile-dashboard.png',
    alt: 'Главная учителя',
  },
  {
    caption: 'Календарь — слоты, конфликты, переносы',
    desktop: '/assets/landing-v3/screens/feature-schedule.png',
    mobile: '/assets/landing-v3/screens/teacher-mobile-dashboard.png',
    alt: 'Календарь занятий',
  },
  {
    caption: 'Журнал оплат — СБП-заявки и подтверждения',
    desktop: '/assets/landing-v3/screens/feature-balance.png',
    mobile: '/assets/landing-v3/screens/teacher-mobile-payments.png',
    alt: 'Журнал оплат',
  },
  {
    caption: 'Карточка ученика — заметки, цели, прошлый урок',
    desktop: '/assets/landing-v3/screens/feature-learner.png',
    mobile: '/assets/landing-v3/screens/teacher-mobile-dashboard.png',
    alt: 'Карточка ученика',
  },
  {
    caption: 'Настройки оплаты — СБП-методы и пакеты',
    desktop: '/assets/landing-v3/screens/feature-methods.png',
    mobile: '/assets/landing-v3/screens/teacher-mobile-payments.png',
    alt: 'Настройки приёма оплат',
  },
]

// Адаптивная подача: SSR-default = desktop, на mobile vh переключаемся в mobile вид.
function useViewportMode() {
  const [mode, setMode] = useState<'desktop' | 'mobile'>('desktop')
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)')
    const apply = () => setMode(mq.matches ? 'mobile' : 'desktop')
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])
  return mode
}

export function ScreenCarousel() {
  const mode = useViewportMode()
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  const touchStartX = useRef<number | null>(null)

  const next = useCallback(() => setIndex((i) => (i + 1) % SLIDES.length), [])
  const prev = useCallback(() => setIndex((i) => (i - 1 + SLIDES.length) % SLIDES.length), [])

  // autoplay — пауза при hover/touch + respect prefers-reduced-motion
  useEffect(() => {
    if (paused) return
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const id = setInterval(next, 4500)
    return () => clearInterval(id)
  }, [paused, next])

  // keyboard
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'ArrowRight') next()
      if (e.key === 'ArrowLeft') prev()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [next, prev])

  const slide = SLIDES[index]

  return (
    <section
      id="screens"
      className="landing-v3-section"
      aria-roledescription="carousel"
      aria-label="Скриншоты кабинета"
      style={{ position: 'relative', overflow: 'hidden', paddingBlock: 'clamp(80px, 12vh, 140px)' }}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onTouchStart={(e) => {
        setPaused(true)
        touchStartX.current = e.touches[0].clientX
      }}
      onTouchEnd={(e) => {
        if (touchStartX.current == null) return
        const delta = e.changedTouches[0].clientX - touchStartX.current
        if (Math.abs(delta) > 40) (delta < 0 ? next : prev)()
        touchStartX.current = null
        setTimeout(() => setPaused(false), 4000)
      }}
    >
      <div style={{ maxWidth: 1180, marginInline: 'auto' }}>
        <div style={{ textAlign: 'center', maxWidth: 760, marginInline: 'auto', marginBottom: 56 }}>
          <motion.h2
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ duration: 0.7 }}
            className="landing-v3-h2 landing-v3-h2--serif"
          >
            Так это <em>выглядит изнутри.</em>
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 18 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ duration: 0.7, delay: 0.1 }}
            className="landing-v3-lede"
            style={{ marginTop: 22, marginInline: 'auto' }}
          >
            Не маркетинговые скрины. Реальный кабинет с тестовыми учениками — точно так же ты увидишь его после регистрации.
          </motion.p>
        </div>

        {/* Frame */}
        <div
          style={{
            position: 'relative',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            paddingInline: 'clamp(16px, 4vw, 40px)',
            minHeight: mode === 'mobile' ? 540 : 460,
          }}
        >
          <AnimatePresence mode="wait">
            {mode === 'desktop' ? (
              <motion.div
                key={`d-${index}`}
                initial={{ opacity: 0, scale: 0.97, y: 12 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.97, y: -8 }}
                transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                style={{ width: '100%', maxWidth: 920 }}
              >
                <LaptopFrame>
                  <Image
                    src={slide.desktop}
                    alt={slide.alt}
                    fill
                    sizes="(max-width: 760px) 100vw, 920px"
                    style={{ objectFit: 'cover', objectPosition: 'top center' }}
                    priority={index === 0}
                  />
                </LaptopFrame>
              </motion.div>
            ) : (
              <motion.div
                key={`m-${index}`}
                initial={{ opacity: 0, scale: 0.96, y: 12 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: -8 }}
                transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
              >
                <PhoneFrame>
                  <Image
                    src={slide.mobile}
                    alt={slide.alt}
                    fill
                    sizes="(max-width: 760px) 100vw, 280px"
                    style={{ objectFit: 'cover', objectPosition: 'top center' }}
                    priority={index === 0}
                  />
                </PhoneFrame>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Side arrows (desktop) */}
          {mode === 'desktop' ? (
            <>
              <button
                type="button"
                onClick={prev}
                aria-label="Предыдущий скрин"
                style={arrowStyle('left')}
              >
                ←
              </button>
              <button
                type="button"
                onClick={next}
                aria-label="Следующий скрин"
                style={arrowStyle('right')}
              >
                →
              </button>
            </>
          ) : null}
        </div>

        {/* Caption */}
        <div style={{ marginTop: 32, textAlign: 'center', minHeight: 44 }}>
          <AnimatePresence mode="wait">
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.35 }}
              style={{ fontSize: 15, color: 'var(--v3-text-secondary)' }}
            >
              {slide.caption}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Slide announcement for screen readers */}
        <div role="status" aria-live="polite" aria-atomic="true" style={{ position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap', border: 0 }}>
          {`Слайд ${index + 1} из ${SLIDES.length}: ${slide.caption}`}
        </div>

        {/* Dots + pause toggle */}
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 16, marginTop: 24 }}>
          <div role="tablist" aria-label="Выбрать скрин" style={{ display: 'flex', gap: 10 }}>
            {SLIDES.map((s, i) => (
              <button
                key={i}
                type="button"
                role="tab"
                aria-selected={i === index}
                aria-label={`Скрин ${i + 1}: ${s.caption}`}
                tabIndex={i === index ? 0 : -1}
                onClick={() => setIndex(i)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowRight') { e.preventDefault(); setIndex((i + 1) % SLIDES.length); }
                  if (e.key === 'ArrowLeft') { e.preventDefault(); setIndex((i - 1 + SLIDES.length) % SLIDES.length); }
                  if (e.key === 'Home') { e.preventDefault(); setIndex(0); }
                  if (e.key === 'End') { e.preventDefault(); setIndex(SLIDES.length - 1); }
                }}
                style={{
                  width: i === index ? 28 : 8,
                  height: 8,
                  borderRadius: 4,
                  background: i === index ? 'var(--v3-accent-end)' : 'rgba(255,255,255,0.18)',
                  border: 'none',
                  cursor: 'pointer',
                  transition: 'width 250ms ease, background 250ms ease',
                  padding: 0,
                }}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={() => setPaused((p) => !p)}
            aria-label={paused ? 'Возобновить автопрокрутку' : 'Остановить автопрокрутку'}
            style={{
              width: 32,
              height: 32,
              borderRadius: '50%',
              border: '1px solid var(--v3-rule-strong)',
              background: 'rgba(11,11,12,0.5)',
              color: 'var(--v3-text-secondary)',
              fontSize: 12,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 0,
              lineHeight: 1,
            }}
          >
            <span aria-hidden="true">{paused ? '▶' : '❚❚'}</span>
          </button>
        </div>
      </div>
    </section>
  )
}

function arrowStyle(side: 'left' | 'right'): React.CSSProperties {
  return {
    position: 'absolute',
    [side]: 'clamp(8px, 2vw, 28px)' as never,
    top: '50%',
    transform: 'translateY(-50%)',
    width: 44,
    height: 44,
    borderRadius: '50%',
    border: '1px solid var(--v3-rule-strong)',
    background: 'rgba(11, 11, 12, 0.7)',
    backdropFilter: 'blur(8px)',
    color: 'var(--v3-text-primary)',
    fontSize: 18,
    cursor: 'pointer',
    zIndex: 5,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'background 200ms ease, transform 200ms ease',
  }
}

// ─── Laptop / Phone frames — те же, что в multi-platform ───

function LaptopFrame({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <div
        aria-hidden
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
            '0 30px 60px -20px rgba(0,0,0,0.55)',
            '0 60px 100px -30px rgba(0,0,0,0.45)',
          ].join(', '),
          zIndex: 1,
        }}
      >
        <div
          aria-hidden
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
        </div>
      </div>
      <div
        aria-hidden
        style={{
          position: 'relative',
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

function PhoneFrame({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ position: 'relative', width: 240 }}>
      <div
        aria-hidden
        style={{
          position: 'absolute',
          left: '15%',
          right: '15%',
          bottom: -16,
          height: 36,
          background: 'radial-gradient(ellipse at center, rgba(232,168,144,0.28) 0%, transparent 60%)',
          filter: 'blur(20px)',
          zIndex: 0,
        }}
      />
      <div
        style={{
          position: 'relative',
          width: '100%',
          aspectRatio: '9 / 19.5',
          background: 'linear-gradient(180deg, #2a2a2f 0%, #1c1c20 100%)',
          borderRadius: 36,
          padding: 5,
          border: '1px solid rgba(255,255,255,0.08)',
          boxShadow: [
            'inset 0 1px 0 rgba(255,255,255,0.14)',
            '0 24px 60px -18px rgba(0,0,0,0.55)',
            '0 50px 90px -30px rgba(232,168,144,0.12)',
          ].join(', '),
          zIndex: 1,
        }}
      >
        <div
          style={{
            position: 'relative',
            width: '100%',
            height: '100%',
            background: '#0B0B0C',
            borderRadius: 32,
            overflow: 'hidden',
          }}
        >
          <div
            aria-hidden
            style={{
              position: 'absolute',
              top: 8,
              left: '50%',
              transform: 'translateX(-50%)',
              width: 78,
              height: 22,
              background: '#0a0a0c',
              borderRadius: 14,
              zIndex: 3,
            }}
          />
          {children}
        </div>
      </div>
    </div>
  )
}
