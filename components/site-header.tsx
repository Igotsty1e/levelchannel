'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

import { BrandMark } from '@/components/brand/brand-mark'

// 2026-06-07 (mobile-first refit): nav cluster reduced to a single
// «Выйти» action for authenticated users. Email и «Кабинет» pill
// убраны — на узких экранах они уезжали за край (owner feedback),
// а «Кабинет» дублировал переход, который уже доступен через bottom-nav
// внутри /teacher и через основной CTA на /cabinet.
type AuthState =
  | { kind: 'loading' }
  | { kind: 'guest' }
  | { kind: 'user' }

const pillStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  background: 'transparent',
  border: '1px solid var(--border)',
  borderRadius: 6,
  color: 'var(--text)',
  fontSize: 13,
  fontWeight: 500,
  padding: '6px 12px',
  cursor: 'pointer',
  textDecoration: 'none',
  lineHeight: 1.2,
}

// Mounted on auth + legal surfaces (not on the bespoke landing or
// /thank-you). Renders unauthenticated state on first paint to avoid
// any flash of "Кабинет" for guests.
export function SiteHeader() {
  const [state, setState] = useState<AuthState>({ kind: 'loading' })

  useEffect(() => {
    let cancelled = false
    fetch('/api/auth/me', { credentials: 'same-origin' })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (cancelled) return
        // /api/auth/me returns { account: { email, ... }, session: ... }.
        // The earlier flat shape (body.email) was the bug that made
        // the header always render the guest variant. We only check
        // for the email's presence — the value itself is no longer
        // rendered (см. шапку файла).
        const email = body?.account?.email
        if (typeof email === 'string') {
          setState({ kind: 'user' })
        } else {
          setState({ kind: 'guest' })
        }
      })
      .catch(() => {
        if (!cancelled) setState({ kind: 'guest' })
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function logout() {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'same-origin',
      })
    } catch {
      // ignore — UI redirects regardless to give the user a clean exit
    }
    window.location.href = '/'
  }

  return (
    <header
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 40,
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        background: 'rgba(11, 11, 12, 0.72)',
        borderBottom: '1px solid var(--border)',
      }}
    >
      <div
        style={{
          maxWidth: 1180,
          margin: '0 auto',
          padding: '14px 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
        }}
      >
        <Link
          href="/"
          style={{
            color: 'var(--text)',
            textDecoration: 'none',
            display: 'inline-flex',
            alignItems: 'center',
          }}
          aria-label="LevelChannel — на главную"
        >
          <BrandMark variant="full" width={150} />
        </Link>

        <nav style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          {state.kind === 'user' ? (
            <button type="button" onClick={logout} style={pillStyle}>
              Выйти
            </button>
          ) : state.kind === 'guest' ? (
            <Link
              href="/login"
              style={{
                color: 'var(--text)',
                textDecoration: 'none',
                fontSize: 14,
                fontWeight: 500,
              }}
            >
              Войти
            </Link>
          ) : null}
        </nav>
      </div>
    </header>
  )
}
