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
  return (
    <div
      style={{
        border: '1px solid #ff8a8a55',
        borderRadius: 8,
        padding: 20,
        marginBottom: 24,
      }}
    >
      <h2
        style={{
          fontSize: 15,
          fontWeight: 600,
          marginBottom: 8,
          color: '#ffcfcf',
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
        Эти действия разлогинят вас и заблокируют аккаунт. Удаление можно
        отменить в течение 30 дней, написав нам — после анонимизация
        необратима.
      </p>

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
        setErr(data?.error || `HTTP ${res.status}`)
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
