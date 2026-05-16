'use client'

import { useState } from 'react'

// ALERTS-OBS (2026-05-16) — dry-run test-send button.
// Plan: docs/plans/alerts-obs.md §4.6.
//
// Three prompts: confirmReason (free-text, ≥3 chars), then a final
// confirm. Each click generates a fresh UUID Idempotency-Key — same
// pattern as PKG-RECON actions-cell + PKG-ADMIN-GRANT grant button.

type Props = {
  probeName: 'auth-flow' | 'calendar-pathology' | 'webhook-flow'
  disabled?: boolean
}

export function TestSendButton({ probeName, disabled }: Props) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function onClick() {
    setError(null)
    setResult(null)
    const reason = prompt(
      `Тестовый алерт для ${probeName}. Опишите причину (логируется в audit):`,
    )?.trim()
    if (!reason || reason.length < 3) {
      if (reason !== null && reason !== undefined && reason !== '') {
        setError('Причина должна быть не короче 3 символов.')
      }
      return
    }
    if (!confirm(`Отправить тестовое письмо для ${probeName}?`)) return

    setBusy(true)
    try {
      const res = await fetch(
        `/api/admin/settings/alerts/${probeName}/test-send`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': crypto.randomUUID(),
          },
          body: JSON.stringify({ confirmReason: reason }),
        },
      )
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setError(data?.message || data?.error || `HTTP ${res.status}`)
        setBusy(false)
        return
      }
      setResult(`Отправлено. email id: ${data?.emailId ?? '(нет)'}`)
      setBusy(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'unknown error')
      setBusy(false)
    }
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <button
        type="button"
        onClick={onClick}
        disabled={busy || disabled}
        style={{
          background: 'transparent',
          color: 'var(--text)',
          border: '1px solid var(--border)',
          padding: '6px 12px',
          borderRadius: 6,
          fontSize: 13,
          cursor: busy || disabled ? 'not-allowed' : 'pointer',
          opacity: busy || disabled ? 0.5 : 1,
        }}
      >
        {busy ? 'Отправляю…' : 'Тестовый алерт'}
      </button>
      {result ? (
        <span style={{ color: '#5cb85c', fontSize: 12 }}>{result}</span>
      ) : null}
      {error ? (
        <span style={{ color: '#ff8a8a', fontSize: 12 }}>{error}</span>
      ) : null}
    </span>
  )
}
