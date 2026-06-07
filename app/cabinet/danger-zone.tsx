'use client'

import { useState } from 'react'

// Two destructive actions side by side. Both clear the cookie and
// redirect to /login when successful.
//
// Withdraw consent (152-ФЗ ст.9 §5): operator stops processing PD;
// account is disabled but data stays. Reversible by operator side.
//
// Delete account: 30-day grace, then anonymization. Reversible by
// operator within those 30 days; after that the row is anonymized.

export function DangerZone() {
  // 2026-06-07 verstka fix: было кастомное `<div>` с border-radius 8,
  // padding 20 и pink-border #ff8a8a55 — это визуально выбивалось из
  // остальных карточек профиля (`.card` использует --border, radius 16,
  // padding 24). Теперь карточка использует общий `.card` класс, а
  // «опасную» семантику несут заголовок + красные кнопки ниже.
  return (
    <div className="card" style={{ padding: 24, marginBottom: 24 }}>
      <h2
        style={{
          fontSize: 16,
          fontWeight: 600,
          marginBottom: 8,
          color: 'var(--danger, #ffcfcf)',
        }}
      >
        Опасные действия
      </h2>
      <p
        style={{
          color: 'var(--secondary)',
          fontSize: 13,
          lineHeight: 1.6,
          marginBottom: 16,
        }}
      >
        Эти действия разлогинят вас и заблокируют аккаунт.
      </p>
      <ul
        style={{
          color: 'var(--secondary)',
          fontSize: 13,
          lineHeight: 1.6,
          marginBottom: 16,
          paddingLeft: 20,
        }}
      >
        <li>
          <strong style={{ color: 'var(--text)' }}>Отзыв согласия</strong> —
          152-ФЗ ст.9 §5: оператор прекращает обработку персональных данных,
          аккаунт блокируется, но данные сохраняются. Снять блок — написать
          оператору на support@levelchannel.ru.
        </li>
        <li>
          <strong style={{ color: 'var(--text)' }}>Удаление аккаунта</strong>
          {' '}— окно отмены 30 дней. Внутри этого окна можно восстановиться,
          написав оператору. После 30 дней данные обезличиваются (имя, e-mail,
          телефон стираются) — это необратимо, восстановление невозможно.
        </li>
      </ul>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <DestructiveButton
          endpoint="/api/account/consents/withdraw"
          body={{ documentKind: 'personal_data' }}
          confirmText="Отозвать согласие на обработку персональных данных? Аккаунт будет заблокирован."
          label="Отозвать согласие"
        />
        <DestructiveButton
          endpoint="/api/account/delete"
          body={{ confirm: true }}
          confirmText="Удалить аккаунт? Окно отмены — 30 дней, после этого данные обезличиваются."
          label="Удалить аккаунт"
        />
      </div>
    </div>
  )
}

function DestructiveButton({
  endpoint,
  body,
  confirmText,
  label,
}: {
  endpoint: string
  body: Record<string, unknown>
  confirmText: string
  label: string
}) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function onClick() {
    if (!confirm(confirmText)) return
    setBusy(true)
    setErr(null)
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        setErr(data?.message || data?.error || `HTTP `)
        setBusy(false)
        return
      }
      window.location.href = '/login'
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'unknown')
      setBusy(false)
    }
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        style={{
          padding: '8px 14px',
          background: 'transparent',
          color: '#ffcfcf',
          border: '1px solid #ff8a8a55',
          borderRadius: 6,
          fontSize: 13,
          cursor: busy ? 'wait' : 'pointer',
          opacity: busy ? 0.6 : 1,
        }}
      >
        {busy ? '...' : label}
      </button>
      {err ? <span style={{ color: '#ff8a8a', fontSize: 12 }}>{err}</span> : null}
    </span>
  )
}
