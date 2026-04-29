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
    <button type="button" onClick={onClick} disabled={pending} className="btn-secondary">
      {pending ? 'Выходим…' : 'Выйти'}
    </button>
  )
}
