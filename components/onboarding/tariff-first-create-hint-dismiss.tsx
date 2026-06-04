'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

export function TariffFirstCreateHintDismissButton() {
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
          body: JSON.stringify({ hintKey: 'tariff_first_create_hint' }),
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
        aria-label="Скрыть подсказку «Что такое цена занятия»"
        style={{
          background: 'transparent',
          border: 'none',
          color: 'var(--secondary)',
          fontSize: 12,
          cursor: pending ? 'not-allowed' : 'pointer',
          padding: '2px 0',
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
