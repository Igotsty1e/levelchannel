'use client'

// mig 0101 — UI selector для учительской выбора payment_method per pair.
// Plan: docs/plans/per-learner-payment-method.md.
//
// POSTs к PATCH /api/teacher/learners/[id]/billing.
//
// Cabinet polish 2026-06-07 (B4): tokens + <Button>.

import { useState, useTransition } from 'react'

import { Button } from '@/components/ui/primitives'
import { localizeTeacherError } from '@/lib/i18n/teacher-errors'

// epic-b Sub-PR B.1/B.2 (2026-06-11): dropped 'prepaid_packages'.
// Booking always mixes — package consume first, postpaid fallback.
// The toggle now exposes two states: 'postpaid' (booking open + mix
// billing) and 'none' (booking blocked until teacher picks).
type Method = 'postpaid' | 'none'

const METHOD_LABEL: Record<Method, string> = {
  postpaid: 'Принимаю оплату (пакеты + счёт)',
  none: 'Не выбран (бронирование заблокировано)',
}

const HELP_TEXT: Record<Method, string> = {
  postpaid:
    'Ученик записывается, занятие сначала списывается с активного пакета. Если пакета нет — копится долг, вы периодически выставляете счёт за пределами платформы.',
  none: 'Ученик не может записаться к вам. Выберите способ оплаты, чтобы открыть бронирование.',
}

export function PaymentMethodToggle({
  learnerId,
  initialMethod,
}: {
  learnerId: string
  initialMethod: Method
}) {
  const [method, setMethod] = useState<Method>(initialMethod)
  const [pendingMethod, setPendingMethod] = useState<Method | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const onChange = (next: Method) => {
    if (next === method) return
    setPendingMethod(next)
    setError(null)
    setInfo(null)
  }

  const onSave = () => {
    if (!pendingMethod) return
    const next = pendingMethod
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
        setMethod(next)
        setPendingMethod(null)
        setInfo('Сохранено.')
      } catch {
        setError('Не удалось соединиться с сервером. Проверьте интернет.')
      }
    })
  }

  const current = pendingMethod ?? method
  const dirty = pendingMethod !== null && pendingMethod !== method

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
      <h2 style={{ fontSize: 17, fontWeight: 600, marginBottom: 8 }}>
        Способ оплаты
      </h2>
      <p style={{ color: 'var(--secondary)', fontSize: 13, marginBottom: 12 }}>
        Платформа не принимает деньги учеников. Выберите, как этот ученик
        платит вам.
      </p>

      <div
        role="radiogroup"
        aria-label="Способ оплаты"
        style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
      >
        {(['postpaid', 'none'] as Method[]).map((m) => (
          <label
            key={m}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 8,
              padding: 10,
              borderRadius: 8,
              cursor: isPending ? 'wait' : 'pointer',
              background:
                current === m ? 'var(--accent-bg)' : 'transparent',
              border:
                current === m
                  ? '1px solid var(--accent)'
                  : '1px solid var(--border)',
            }}
          >
            <input
              type="radio"
              name="payment-method"
              value={m}
              checked={current === m}
              onChange={() => onChange(m)}
              disabled={isPending}
              style={{ marginTop: 3 }}
            />
            <span style={{ display: 'flex', flexDirection: 'column' }}>
              <strong style={{ fontSize: 14 }}>{METHOD_LABEL[m]}</strong>
              <span style={{ fontSize: 12, color: 'var(--secondary)', lineHeight: 1.5 }}>
                {HELP_TEXT[m]}
              </span>
            </span>
          </label>
        ))}
      </div>

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
