'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

export function LogoutButton() {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  async function onClick() {
    if (pending) return
    setPending(true)
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'same-origin',
      })
    } catch {
      // Network failure is harmless here — server-side cookie may not have
      // cleared, but the next /cabinet visit will re-check and bounce back
      // to /login if the session is still valid. Surfacing an error to the
      // user here would only cause confusion.
    }
    router.push('/')
    router.refresh()
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      style={{
        color: 'var(--text)',
        background: 'rgba(255,255,255,0.05)',
        border: '1px solid rgba(255,255,255,0.08)',
        fontSize: 14,
        padding: '6px 14px',
        borderRadius: 8,
        cursor: pending ? 'default' : 'pointer',
        opacity: pending ? 0.6 : 1,
      }}
    >
      {pending ? 'Выходим…' : 'Выйти'}
    </button>
  )
}
