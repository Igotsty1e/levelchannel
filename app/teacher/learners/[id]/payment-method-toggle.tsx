'use client'

// 2026-06-12: переименован в «Активный ученик» (новый design-system
// Checkbox). Под капотом тот же 2-state контракт:
//   • Активный = `payment_method: 'postpaid'` — ученик может бронировать,
//     оплата мисуется с пакета или копится постоплатой.
//   • Неактивный = `payment_method: 'none'` — backend блокирует
//     бронирование, ученик видит банер «Способ оплаты не выбран».
//
// PATCH /api/teacher/learners/[id]/billing — body { method }.

import { useState, useTransition } from 'react'

import { Button, Checkbox } from '@/components/ui/primitives'
import { localizeTeacherError } from '@/lib/i18n/teacher-errors'

type Method = 'postpaid' | 'none'

export function PaymentMethodToggle({
  learnerId,
  initialMethod,
}: {
  learnerId: string
  initialMethod: Method
}) {
  const [savedActive, setSavedActive] = useState(initialMethod === 'postpaid')
  const [active, setActive] = useState(initialMethod === 'postpaid')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const dirty = active !== savedActive

  const onSave = () => {
    const next: Method = active ? 'postpaid' : 'none'
    setError(null)
    setInfo(null)
    startTransition(async () => {
      try {
        const res = await fetch(
          `/api/teacher/learners/${learnerId}/billing`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ method: next }),
          },
        )
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          setError(
            localizeTeacherError(body?.error)
              ?? 'Не удалось сохранить настройку. Попробуйте позже.',
          )
          return
        }
        setSavedActive(active)
        setInfo('Сохранено.')
      } catch {
        setError('Не удалось соединиться с сервером. Проверьте интернет.')
      }
    })
  }

  return (
    <section
      style={{
        padding: 16,
        background: 'var(--surface-1)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        marginBottom: 24,
      }}
    >
      <h2 style={{ fontSize: 17, fontWeight: 600, marginBottom: 12 }}>
        Доступ к бронированию
      </h2>
      <Checkbox
        checked={active}
        onChange={(next) => {
          setActive(next)
          setError(null)
          setInfo(null)
        }}
        disabled={isPending}
        label="Активный ученик"
        hint="Может бронировать слоты и тратить пакеты"
      />
      {!active ? (
        <p
          style={{
            color: 'var(--secondary)',
            fontSize: 12,
            lineHeight: 1.5,
            marginTop: 10,
          }}
        >
          Когда выключено — ученик не может записаться к вам. Включите, как
          только готовы принять его на занятия.
        </p>
      ) : null}

      {error ? (
        <p
          role="alert"
          style={{
            marginTop: 12,
            color: 'var(--danger)',
            fontSize: 13,
            background: 'var(--danger-bg)',
            padding: '8px 12px',
            borderRadius: 8,
          }}
        >
          {error}
        </p>
      ) : null}
      {info ? (
        <p
          role="status"
          style={{
            marginTop: 12,
            color: '#9BDF9B',
            fontSize: 13,
          }}
        >
          {info}
        </p>
      ) : null}

      {dirty ? (
        <div style={{ marginTop: 12 }}>
          <Button type="button" onClick={onSave} disabled={isPending} loading={isPending}>
            Сохранить
          </Button>
        </div>
      ) : null}
    </section>
  )
}
