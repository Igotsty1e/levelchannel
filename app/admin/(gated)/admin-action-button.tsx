'use client'

import { useState } from 'react'

type Props = {
  endpoint: string
  body?: Record<string, unknown>
  method?: 'POST' | 'PATCH' | 'DELETE'
  confirmText?: string
  children: React.ReactNode
  variant?: 'primary' | 'danger' | 'ghost'
}

// Tiny client island so the SSR-only admin pages can POST to the
// JSON API routes without each page shipping its own fetch boilerplate.
// On success the page reloads to show fresh state.
export function AdminActionButton({
  endpoint,
  body,
  method = 'POST',
  confirmText,
  children,
  variant = 'primary',
}: Props) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function onClick() {
    if (confirmText && !confirm(confirmText)) return
    setBusy(true)
    setErr(null)
    try {
      const res = await fetch(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        setErr(data?.error || `HTTP ${res.status}`)
        setBusy(false)
        return
      }
      window.location.reload()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'unknown error')
      setBusy(false)
    }
  }

  const styles: Record<typeof variant, React.CSSProperties> = {
    primary: {
      background: 'var(--accent)',
      color: 'var(--accent-contrast)',
      border: 'none',
    },
    danger: {
      background: 'transparent',
      color: '#ff8a8a',
      border: '1px solid #ff8a8a55',
    },
    ghost: {
      background: 'transparent',
      color: 'var(--text)',
      border: '1px solid var(--border)',
    },
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        style={{
          ...styles[variant],
          padding: '6px 12px',
          borderRadius: 6,
          fontSize: 13,
          cursor: busy ? 'wait' : 'pointer',
          opacity: busy ? 0.6 : 1,
        }}
      >
        {busy ? '...' : children}
      </button>
      {err ? (
        <span style={{ color: '#ff8a8a', fontSize: 12 }}>{err}</span>
      ) : null}
    </span>
  )
}
