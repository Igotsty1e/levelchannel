'use client'

// Sub-PR C CT1 — dismiss button for verify_email_reminder hint card on
// /cabinet. Pattern mirrors learner-cabinet-tour-dismiss.tsx.

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

export function VerifyEmailReminderDismissButton() {
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  function onClick() {
    if (pending) return
    setError(null)
    startTransition(async () => {
      try {
        const res = await fetch('/api/onboarding/dismiss-hint', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ hintKey: 'verify_email_reminder' }),
        })
        if (!res.ok) {
          setError('Не удалось скрыть. Попробуйте ещё раз.')
          return
        }
        router.refresh()
      } catch {
        setError('Сетевая ошибка. Попробуйте ещё раз.')
      }
    })
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        gap: 4,
        marginTop: 8,
      }}
    >
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        aria-label="Скрыть напоминание о подтверждении почты"
        style={{
          background: 'transparent',
          color: 'var(--secondary)',
          border: '1px solid var(--border)',
          borderRadius: 6,
          padding: '4px 12px',
          fontSize: 12,
          cursor: pending ? 'not-allowed' : 'pointer',
        }}
      >
        {pending ? 'Скрываем…' : 'Скрыть подсказку'}
      </button>
      {error ? (
        <span
          role="alert"
          style={{ color: 'var(--danger, #e07676)', fontSize: 12 }}
        >
          {error}
        </span>
      ) : null}
    </div>
  )
}
