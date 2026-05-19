'use client'

import { useState } from 'react'

import type { ProbeName } from '@/lib/admin/probe-status'

// ALERTS-OBS (2026-05-16) — dry-run test-send button.
// Plan: docs/plans/alerts-obs.md §4.6.
//
// Three prompts: confirmReason (free-text, ≥3 chars), then a final
// confirm. Each click generates a fresh UUID Idempotency-Key — same
// pattern as PKG-RECON actions-cell + PKG-ADMIN-GRANT grant button.
//
// BCS-DEF-1 Phase 1 (2026-05-19): prop union widened to ProbeName
// (single source of truth in `lib/admin/probe-status.ts`). The
// `'conflict-unresolved'` probe is in the type union now but not in
// PROBE_NAMES iteration — so this button doesn't render for it until
// Phase 2 wires the probe + Phase 3 (or Phase 2) adds the
// `test_send_deferred` short-circuit per plan §1.3 + §2.7.

type Props = {
  probeName: ProbeName
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
