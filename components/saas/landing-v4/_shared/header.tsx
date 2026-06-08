'use client'

import Link from 'next/link'

export function LandingHeader() {
  return (
    <header
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 50,
        padding: '20px clamp(24px, 4vw, 80px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        backdropFilter: 'blur(16px) saturate(140%)',
        background: 'rgba(11, 11, 12, 0.7)',
        borderBottom: '1px solid var(--v4-rule)',
      }}
    >
      <Link
        href="/"
        style={{
          fontFamily: 'var(--v4-font-serif)',
          fontSize: 20,
          letterSpacing: '-0.01em',
          color: 'var(--v4-text-primary)',
          textDecoration: 'none',
        }}
      >
        LevelChannel
      </Link>
      <nav style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
        <Link
          href="/saas/learn/cabinet"
          style={{
            color: 'var(--v4-text-secondary)',
            textDecoration: 'none',
            fontSize: 14,
          }}
        >
          Как это работает
        </Link>
        <Link
          href={`/register?role=teacher&utm_source=landing-v4&utm_content=nav`}
          className="v4-cta"
          style={{ padding: '10px 20px', fontSize: 14 }}
        >
          Открыть кабинет
        </Link>
      </nav>
    </header>
  )
}
