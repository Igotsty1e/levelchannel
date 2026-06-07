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
        <Link href="/saas/v3" style={{ display: 'inline-flex', alignItems: 'center', textDecoration: 'none', color: '#F5F5F7' }}>
          <BrandMark variant="full" width={180} />
        </Link>

        <nav style={{ display: 'flex', alignItems: 'center', gap: 24, marginLeft: 16 }}>
          {NAV.map((n) => (
            <a
              key={n.href}
              href={n.href}
              style={{
                color: 'var(--v3-text-secondary)',
                fontSize: 14,
                textDecoration: 'none',
                transition: 'color 180ms ease',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = '#F5F5F7')}
              onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--v3-text-secondary)')}
            >
              {n.label}
            </a>
          ))}
        </nav>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
          <Link
            href="/login"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '8px 18px',
              borderRadius: 999,
              background: 'transparent',
              color: '#F5F5F7',
              fontSize: 14,
              fontWeight: 500,
              border: '1px solid rgba(255,255,255,0.18)',
              textDecoration: 'none',
              transition: 'background 180ms ease, border-color 180ms ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255,255,255,0.06)'
              e.currentTarget.style.borderColor = 'rgba(255,255,255,0.3)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
              e.currentTarget.style.borderColor = 'rgba(255,255,255,0.18)'
            }}
          >
            Войти
          </Link>
        </div>
      </div>
    </header>
  )
}
