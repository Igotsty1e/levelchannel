'use client'

import { useState } from 'react'

// BCS-DEF-2 — operator action buttons for the /admin/slots/conflicts
// dashboard. Two actions per row:
//
//   1. Снять конфликт (Dismiss) — clears `external_conflict_at` and
//      sibling columns. Re-stamped on next pull if the foreign overlap
//      still applies.
//
//   2. Отменить занятие (Cancel-from-conflict) — calls the existing
//      cancel route with `fromConflict: true`. The cleanup TX clears
//      the conflict columns so the row leaves the badge count.
//
// Each click generates a fresh Idempotency-Key. The reason input is
// inline (single textarea) — the operator picks the action button
// after typing.
//
// Plan: docs/plans/conflict-feed.md §3.5.

type Props = {
  slotId: string
}

function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `idem-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function ConflictsActionsCell({ slotId }: Props) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState<null | 'dismiss' | 'cancel'>(null)
  const [err, setErr] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  async function doDismiss() {
    setErr(null)
    setDone(null)
    const trimmed = reason.trim()
    if (trimmed.length < 3) {
      setErr('Укажите причину (минимум 3 символа).')
      return
    }
    setBusy('dismiss')
    try {
      const res = await fetch(
        `/api/admin/slots/${encodeURIComponent(slotId)}/dismiss-conflict`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': uuid(),
          },
          body: JSON.stringify({ reason: trimmed }),
        },
      )
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setErr(json.message ?? json.error ?? `HTTP ${res.status}`)
      } else {
        setDone('Снят')
        setTimeout(() => window.location.reload(), 1200)
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'unknown')
    } finally {
      setBusy(null)
    }
  }

  async function doCancel() {
    setErr(null)
    setDone(null)
    const trimmed = reason.trim()
    if (trimmed.length < 3) {
      setErr('Укажите причину (минимум 3 символа).')
      return
    }
    setBusy('cancel')
    try {
      const res = await fetch(
        `/api/admin/slots/${encodeURIComponent(slotId)}/cancel`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': uuid(),
          },
          body: JSON.stringify({ reason: trimmed, fromConflict: true }),
        },
      )
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setErr(json.message ?? json.error ?? `HTTP ${res.status}`)
      } else {
        setDone('Отменено')
        setTimeout(() => window.location.reload(), 1200)
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'unknown')
    } finally {
      setBusy(null)
    }
  }

  if (done) {
    return (
      <span style={{ color: 'var(--accent)', fontSize: 12 }}>✓ {done}</span>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 200 }}>
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Причина (видна оператору в журнале)"
        rows={2}
        disabled={busy !== null}
        style={{
          fontSize: 12,
          padding: '6px 8px',
          border: '1px solid var(--border)',
          borderRadius: 4,
          background: 'var(--bg)',
          color: 'var(--text)',
          resize: 'vertical',
          minHeight: 40,
        }}
      />
      <div style={{ display: 'flex', gap: 6 }}>
        <button
          type="button"
          onClick={doDismiss}
          disabled={busy !== null}
          style={btnStyle('primary')}
          title="Очистить отметку конфликта. Если внешний событие в Google всё ещё пересекается, конфликт встанет обратно после следующего pull."
        >
          {busy === 'dismiss' ? '…' : 'Снять конфликт'}
        </button>
        <button
          type="button"
          onClick={doCancel}
          disabled={busy !== null}
          style={btnStyle('secondary')}
          title="Отменить занятие от лица оператора. Учащийся увидит отмену в кабинете."
        >
          {busy === 'cancel' ? '…' : 'Отменить занятие'}
        </button>
      </div>
      {err ? (
        <span style={{ color: '#ff8a8a', fontSize: 11 }}>{err}</span>
      ) : null}
    </div>
  )
}

function btnStyle(kind: 'primary' | 'secondary'): React.CSSProperties {
  return {
    padding: '4px 10px',
    fontSize: 12,
    border: '1px solid var(--border)',
    background:
      kind === 'primary' ? 'var(--accent)' : 'transparent',
    color: kind === 'primary' ? 'var(--accent-contrast)' : 'var(--text)',
    cursor: 'pointer',
    borderRadius: 4,
    whiteSpace: 'nowrap',
  }
}
