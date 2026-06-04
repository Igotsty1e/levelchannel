'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

// Client island that POSTs the dismiss-hint request and triggers a
// router.refresh() so the SSR re-evaluates `dismissed=true` and the
// parent card disappears.

export function TeacherSetupChecklistDismissButton() {
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
          body: JSON.stringify({ hintKey: 'teacher_setup_checklist' }),
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
        aria-label="Скрыть подсказку «Настройте кабинет»"
        style={{
          background: 'transparent',
          border: 'none',
          color: 'var(--secondary)',
          fontSize: 13,
          cursor: pending ? 'not-allowed' : 'pointer',
          padding: '4px 0',
        }}
      >
        {pending ? 'Скрываем…' : 'Скрыть пока что'}
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
