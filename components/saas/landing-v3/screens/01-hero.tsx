'use client'

import Link from 'next/link'

import { BackgroundBeams } from '@/components/ui/aceternity'
import { AssetOrPlaceholder } from '../_shared/placeholder'

export function ScreenHero() {
  return (
    <section
      style={{
        position: 'relative',
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '96px 24px 80px',
        overflow: 'hidden',
      }}
    >
      {/* Veo 3.1 ambient loop behind everything */}
      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
        <video
          src="/assets/landing-v3/video/hero-ambient.mp4"
          autoPlay
          muted
          loop
          playsInline
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            opacity: 0.28,
            mixBlendMode: 'screen',
          }}
        />
        {/* Bottom-to-top warm fade so text + CTA сидят на чёрном, не обрезаясь визуально */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background:
              'linear-gradient(180deg, rgba(11,11,12,0.55) 0%, rgba(11,11,12,0.25) 30%, rgba(11,11,12,0.55) 65%, rgba(11,11,12,0.92) 100%)',
          }}
        />
      </div>

      <BackgroundBeams />

      <div style={{ position: 'relative', zIndex: 2, maxWidth: 1100, textAlign: 'center' }}>
        <h1 className="landing-v3-h1 landing-v3-h1--gradient" style={{ fontSize: 'clamp(40px, 7vw, 88px)' }}>
          Преподавай.
          <br />
          А переписки <em style={{ fontStyle: 'italic', fontFamily: 'Charter, Iowan Old Style, Georgia, serif' }}>возьмём на себя.</em>
        </h1>
        <p className="landing-v3-lede" style={{ marginTop: 32, marginLeft: 'auto', marginRight: 'auto' }}>
          Кабинет частного репетитора: расписание, ученики, балансы и оплаты — в одном месте. Без шести вкладок, Excel-таблиц и блокнотов.
        </p>
        <div style={{ marginTop: 48, display: 'flex', gap: 16, justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link
            href="/register?role=teacher&utm_source=landing-v3&utm_content=hero"
            className="landing-v3-cta"
          >
            Начать бесплатно →
          </Link>
          <a href="#screens" className="landing-v3-cta landing-v3-cta--ghost">
            Посмотреть кабинет
          </a>
        </div>
        <p style={{ marginTop: 24, fontSize: 13, color: '#6B6B73' }}>
          Карта не нужна · Стартовый навсегда бесплатно · Без e-mail-спама
        </p>
      </div>
    </section>
  )
}
