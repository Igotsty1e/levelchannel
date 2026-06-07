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
      <div style={{ position: 'absolute', inset: 0, opacity: 0.22, mixBlendMode: 'screen', pointerEvents: 'none' }}>
        <AssetOrPlaceholder
          src="/assets/landing-v3/video/hero-ambient.mp4"
          alt="ambient desk loop"
          aspectRatio="auto"
          className=""
          video
        />
      </div>

      <BackgroundBeams />

      <div style={{ position: 'relative', zIndex: 2, maxWidth: 1100, textAlign: 'center' }}>
        <h1 className="landing-v3-h1 landing-v3-h1--gradient" style={{ fontSize: 'clamp(40px, 7vw, 88px)' }}>
          Занимайся преподаванием,
          <br />
          а не <em style={{ fontStyle: 'italic', fontFamily: 'Charter, Iowan Old Style, Georgia, serif' }}>бесконечными переписками</em> с учениками.
        </h1>
        <p className="landing-v3-lede" style={{ marginTop: 32, marginLeft: 'auto', marginRight: 'auto' }}>
          Расписание, ученики, балансы, пакеты. То, что репетитор реально открывает
          каждый день — собрано в одном месте. Бесплатно, навсегда, для первого ученика.
        </p>
        <div style={{ marginTop: 48, display: 'flex', gap: 16, justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link
            href="/register?role=teacher&utm_source=landing-v3&utm_content=hero"
            className="landing-v3-cta"
          >
            Начать бесплатно →
          </Link>
          <a href="#features" className="landing-v3-cta landing-v3-cta--ghost">
            Посмотреть, как выглядит
          </a>
        </div>
        <p style={{ marginTop: 24, fontSize: 13, color: '#6B6B73' }}>
          Без карты при регистрации · Данные не передаются третьим лицам
        </p>
      </div>
    </section>
  )
}
