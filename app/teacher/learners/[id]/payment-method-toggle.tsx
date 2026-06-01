'use client'

// mig 0101 — UI selector для учительской выбора payment_method per pair.
// Plan: docs/plans/per-learner-payment-method.md.
//
// POSTs к PATCH /api/teacher/learners/[id]/billing. Сервер enforces
// Q1 invariant (no switch postpaid→packages с открытым долгом) и
// возвращает 409 `debt_open` — рендерим как банер с CTA к балансу.

import { useState, useTransition } from 'react'

type Method = 'postpaid' | 'prepaid_packages' | 'none'

const METHOD_LABEL: Record<Method, string> = {
  postpaid: 'Постоплата (счёт после уроков)',
  prepaid_packages: 'Пакеты (оплата вперёд)',
  none: 'Не выбран (бронирование заблокировано)',
}

const HELP_TEXT: Record<Method, string> = {
  postpaid: 'Ученик записывается без предварительной оплаты. Долг копится, вы периодически выставляете счёт за пределами платформы.',
  prepaid_packages: 'Ученик покупает пакет уроков заранее. Каждое занятие списывает один пакетный слот.',
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
          if (body?.error === 'debt_open') {
            setError(
              'У ученика остался незакрытый долг по постоплате. Закройте долг ниже, прежде чем переключаться на пакеты.',
            )
          } else {
            setError(body?.message || body?.error || `HTTP ${res.status}`)
          }
          return
        }
        setMethod(next)
        setPendingMethod(null)
        setInfo('Сохранено.')
      } catch (e) {
        setError(e instanceof Error ? e.message : 'unknown')
      }
    })
  }

  const current = pendingMethod ?? method
  const dirty = pendingMethod !== null && pendingMethod !== method

  return (
    <section
      style={{
        padding: 16,
        background: 'var(--surface)',
        borderRadius: 8,
        marginBottom: 24,
      }}
    >
      <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>
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
        {(['postpaid', 'prepaid_packages', 'none'] as Method[]).map((m) => (
          <label
            key={m}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 8,
              padding: 8,
              borderRadius: 6,
              cursor: isPending ? 'wait' : 'pointer',
              border:
                current === m
                  ? '1px solid var(--accent, #c2811e)'
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
              <span style={{ fontSize: 12, color: 'var(--secondary)' }}>
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
            color: '#ff8a8a',
            fontSize: 13,
            background: 'rgba(255,140,140,0.12)',
            padding: '8px 12px',
            borderRadius: 6,
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
            color: '#9bdf9b',
            fontSize: 13,
          }}
        >
          {info}
        </p>
      ) : null}

      {dirty ? (
        <button
          type="button"
          onClick={onSave}
          disabled={isPending}
          style={{
            marginTop: 12,
            padding: '8px 16px',
            border: '1px solid var(--accent, #c2811e)',
            background: 'var(--accent, #c2811e)',
            color: '#fff',
            borderRadius: 6,
            fontSize: 14,
            cursor: isPending ? 'wait' : 'pointer',
          }}
        >
          {isPending ? 'Сохраняем…' : 'Сохранить'}
        </button>
      ) : null}
    </section>
  )
}
