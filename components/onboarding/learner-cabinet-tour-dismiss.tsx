'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

export function LearnerCabinetTourDismissButton() {
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
          body: JSON.stringify({ hintKey: 'learner_cabinet_tour' }),
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
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        aria-label="Скрыть приветственный тур"
        style={{
          background: 'var(--accent, #6ea8fe)',
          color: '#0a0c10',
          border: 'none',
          borderRadius: 6,
          padding: '6px 14px',
          fontSize: 13,
          fontWeight: 600,
          cursor: pending ? 'not-allowed' : 'pointer',
        }}
      >
        {pending ? 'Скрываем…' : 'Понятно'}
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
