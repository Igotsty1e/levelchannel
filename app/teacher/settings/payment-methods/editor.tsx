'use client'

// teacher-payments-sbp-self-service Sub-PR A1 (2026-06-07).
//
// Client-side editor for SBP payment methods. Список существующих +
// форма добавления + actions (set default / restore / archive).

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import type { PaymentMethod } from '@/lib/payments/sbp-methods'
import { Button, Pill } from '@/components/ui/primitives'

const KNOWN_BANKS = [
  'Тинькофф',
  'Сбер',
  'Альфа-Банк',
  'ВТБ',
  'Райффайзенбанк',
  'Газпромбанк',
  'Открытие',
  'Совкомбанк',
]

export function PaymentMethodsEditor({
  initialMethods,
}: {
  initialMethods: PaymentMethod[]
}) {
  const router = useRouter()
  const [methods, setMethods] = useState(initialMethods)
  const [phone, setPhone] = useState('')
  const [bank, setBank] = useState('')
  const [isDefault, setIsDefault] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  async function refresh() {
    try {
      const r = await fetch('/api/teacher/payment-methods', { cache: 'no-store' })
      if (r.ok) {
        const body = await r.json()
        setMethods(body.methods ?? [])
        router.refresh()
      }
    } catch {
      // ignore
    }
  }

  async function add() {
    if (busy) return
    setBusy(true)
    setErr(null)
    setInfo(null)
    try {
      const r = await fetch('/api/teacher/payment-methods', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone,
          bankLabel: bank,
          isDefault: methods.length === 0 ? true : isDefault,
        }),
      })
      if (!r.ok) {
        const data = await r.json().catch(() => ({}))
        const map: Record<string, string> = {
          phone_required: 'Укажите номер телефона.',
          bank_required: 'Укажите банк.',
          invalid_phone: 'Неверный формат — введите номер в виде +7 999 123-45-67.',
          invalid_bank: 'Название банка пустое или слишком длинное.',
          limit_reached: 'Достигнут лимит активных методов (10).',
        }
        setErr(map[data?.error] ?? data?.error ?? `HTTP ${r.status}`)
        return
      }
      setPhone('')
      setBank('')
      setIsDefault(false)
      setInfo('Метод добавлен.')
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  async function setAsDefault(id: string) {
    if (busy) return
    setBusy(true)
    setErr(null)
    setInfo(null)
    try {
      const r = await fetch(`/api/teacher/payment-methods/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isDefault: true }),
      })
      if (!r.ok) {
        setErr('Не удалось обновить.')
        return
      }
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  async function archive(id: string) {
    if (busy) return
    if (!confirm('Архивировать этот метод? Ученики перестанут его видеть.')) {
      return
    }
    setBusy(true)
    setErr(null)
    setInfo(null)
    try {
      const r = await fetch(`/api/teacher/payment-methods/${id}`, {
        method: 'DELETE',
      })
      if (!r.ok) {
        setErr('Не удалось архивировать.')
        return
      }
      setInfo('Метод архивирован.')
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {methods.length === 0 ? (
        <div
          className="card"
          style={{
            padding: 24,
            marginBottom: 24,
            color: 'var(--secondary)',
            fontSize: 14,
            lineHeight: 1.6,
          }}
        >
          Пока ни одного метода. Добавьте первый — после этого ученики
          увидят его в своих кабинетах при оплате занятий.
        </div>
      ) : (
        <div className="card" style={{ padding: 24, marginBottom: 24 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>
            Активные методы
          </h2>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {methods.map((m) => (
              <li
                key={m.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 12,
                  padding: '12px 0',
                  borderTop: '1px solid var(--border)',
                  flexWrap: 'wrap',
                }}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontWeight: 500, fontSize: 15 }}>
                    {m.phoneDisplay} · {m.bankLabel}
                  </div>
                  <div style={{ color: 'var(--secondary)', fontSize: 12, marginTop: 2 }}>
                    {m.isDefault ? (
                      <Pill tone="success" size="sm">
                        По умолчанию
                      </Pill>
                    ) : (
                      <Pill tone="default" size="sm">
                        Запасной
                      </Pill>
                    )}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {!m.isDefault ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setAsDefault(m.id)}
                      disabled={busy}
                    >
                      Сделать основным
                    </Button>
                  ) : null}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => archive(m.id)}
                    disabled={busy}
                  >
                    Архивировать
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="card" style={{ padding: 24, marginBottom: 24 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>
          Добавить метод
        </h2>
        <div style={{ display: 'grid', gap: 12 }}>
          <label style={{ display: 'block' }}>
            <span
              style={{
                display: 'block',
                fontSize: 12,
                fontWeight: 600,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                color: 'var(--secondary)',
                marginBottom: 6,
              }}
            >
              Телефон СБП
            </span>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+7 999 123-45-67"
              disabled={busy}
              style={inputStyle}
            />
          </label>
          <label style={{ display: 'block' }}>
            <span
              style={{
                display: 'block',
                fontSize: 12,
                fontWeight: 600,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                color: 'var(--secondary)',
                marginBottom: 6,
              }}
            >
              Банк
            </span>
            <input
              type="text"
              value={bank}
              onChange={(e) => setBank(e.target.value)}
              placeholder="Тинькофф"
              list="known-banks"
              disabled={busy}
              maxLength={80}
              style={inputStyle}
            />
            <datalist id="known-banks">
              {KNOWN_BANKS.map((b) => (
                <option key={b} value={b} />
              ))}
            </datalist>
          </label>
          {methods.length > 0 ? (
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 14,
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={isDefault}
                onChange={(e) => setIsDefault(e.target.checked)}
                disabled={busy}
              />
              Сделать основным методом
            </label>
          ) : null}
          <div>
            <Button onClick={add} disabled={busy}>
              {busy ? 'Сохраняем…' : 'Добавить'}
            </Button>
          </div>
          {err ? (
            <p style={{ color: 'var(--danger)', fontSize: 13, margin: 0 }}>
              {err}
            </p>
          ) : null}
          {info ? (
            <p style={{ color: 'var(--secondary)', fontSize: 13, margin: 0 }}>
              {info}
            </p>
          ) : null}
        </div>
      </div>
    </>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'var(--surface-2)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  padding: '10px 12px',
  color: 'var(--text)',
  fontSize: 14,
  fontFamily: 'inherit',
  lineHeight: 1.5,
  boxSizing: 'border-box',
}
