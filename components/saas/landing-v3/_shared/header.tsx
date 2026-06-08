'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

import { BrandMark } from '@/components/brand/brand-mark'

const NAV = [
  { href: '#features', label: 'Возможности' },
  { href: '#integrations', label: 'Интеграции' },
  { href: '#security', label: 'Безопасность' },
  { href: '#pricing', label: 'Тарифы' },
]

export function LandingV3Header() {
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 32)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <header
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 50,
        padding: '14px 24px',
        background: scrolled ? 'rgba(11,11,12,0.72)' : 'transparent',
        backdropFilter: scrolled ? 'blur(14px) saturate(130%)' : 'none',
        WebkitBackdropFilter: scrolled ? 'blur(14px) saturate(130%)' : 'none',
        borderBottom: scrolled ? '1px solid rgba(255,255,255,0.06)' : '1px solid transparent',
        transition: 'background 240ms ease, border-color 240ms ease, backdrop-filter 240ms ease',
      }}
    >
      <div
        style={{
          maxWidth: 1280,
          margin: '0 auto',
          display: 'flex',
          alignItems: 'center',
          gap: 32,
        }}
      >
        <Link href="/" style={{ display: 'inline-flex', alignItems: 'center', textDecoration: 'none', color: '#F5F5F7' }}>
          <BrandMark variant="full" width={180} />
        </Link>

        <nav className="landing-v3-nav" aria-label="Главное меню" style={{ display: 'flex', alignItems: 'center', gap: 24, marginLeft: 16 }}>
          {NAV.map((n) => (
            <a key={n.href} href={n.href} className="landing-v3-nav-link">
              {n.label}
            </a>
          ))}
        </nav>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
          <Link
            href="/login"
            className="landing-v3-login-link"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '8px 16px',
              color: 'var(--v3-text-secondary)',
              fontSize: 14,
              fontWeight: 500,
              textDecoration: 'none',
              transition: 'color 180ms ease',
            }}
          >
            Войти
          </Link>
          <Link
            href="/register?role=teacher&utm_source=landing-v3&utm_content=header"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '10px 22px',
              borderRadius: 999,
              background: 'linear-gradient(135deg, #C87878, #E8A890)',
              color: '#0B0B0C',
              fontSize: 14,
              fontWeight: 600,
              textDecoration: 'none',
              boxShadow: '0 8px 24px -10px rgba(232,168,144,0.4)',
              transition: 'transform 200ms ease, box-shadow 200ms ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-1px)'
              e.currentTarget.style.boxShadow = '0 14px 32px -10px rgba(232,168,144,0.55)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)'
              e.currentTarget.style.boxShadow = '0 8px 24px -10px rgba(232,168,144,0.4)'
            }}
          >
            Начать бесплатно
          </Link>
        </div>
      </div>

      <style>{`
        .landing-v3-nav-link {
          color: var(--v3-text-secondary);
          font-size: 14px;
          text-decoration: none;
          transition: color 180ms ease;
        }
        .landing-v3-nav-link:hover,
        .landing-v3-nav-link:focus-visible { color: #F5F5F7; }
        .landing-v3-login-link:hover,
        .landing-v3-login-link:focus-visible { color: #F5F5F7 !important; }
        @media (max-width: 768px) {
          .landing-v3-nav { display: none !important; }
        }
      `}</style>
    </header>
  )
}
