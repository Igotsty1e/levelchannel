'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

type AuthState =
  | { kind: 'loading' }
  | { kind: 'guest' }
  | { kind: 'user'; email: string }

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
        if (body && typeof body.email === 'string') {
          setState({ kind: 'user', email: body.email })
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
            fontWeight: 700,
            fontSize: 16,
            letterSpacing: 0.2,
          }}
        >
          LevelChannel
        </Link>

        <nav style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {state.kind === 'user' ? (
            <Link
              href="/cabinet"
              style={{
                color: 'var(--text)',
                textDecoration: 'none',
                fontSize: 14,
                fontWeight: 500,
              }}
            >
              Кабинет
            </Link>
          ) : (
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
          )}
        </nav>
      </div>
    </header>
  )
}
