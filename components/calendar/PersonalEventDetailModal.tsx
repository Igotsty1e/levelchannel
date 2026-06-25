'use client'

// Epic B (2026-06-19) — детальная модалка дела. Показывает title + body
// + статус, кнопки «Выполнено» / «Отменить дело». Без edit-формы в
// первой итерации; редактирование — через cancel + create (out of
// scope для этого PR).

import { useState } from 'react'

import { Modal } from '@/components/ui/primitives'
import type { CalendarRow } from '@/lib/calendar/view-model'

export function PersonalEventDetailModal({
  row,
  onClose,
  onAction,
}: {
  row: CalendarRow
  onClose: () => void
  onAction: (message: string) => void
}) {
  const slot = row.slot
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // ESC handled by Modal primitive.

  if (slot.kind !== 'personal-event') return null

  const isActive = slot.status === 'personal_event'

  async function call(action: 'complete' | 'cancel') {
    if (slot.kind !== 'personal-event') return
    setBusy(true)
    setErr(null)
    try {
      const res = await fetch(
        `/api/teacher/personal-events/${slot.id}/${action}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        },
      )
      const data = (await res.json().catch(() => ({}))) as {
        error?: string
        message?: string
      }
      if (!res.ok) {
        setErr(data?.message ?? `Ошибка: ${data?.error ?? res.status}`)
        return
      }
      onAction(
        action === 'complete' ? 'Дело отмечено выполненным.' : 'Дело отменено.',
      )
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Не удалось.')
    } finally {
      setBusy(false)
    }
  }

  const statusLabel =
    slot.status === 'personal_event'
      ? '● Активно'
      : slot.status === 'completed'
        ? '✓ Выполнено'
        : '● Отменено'
  const statusColor =
    slot.status === 'personal_event'
      ? 'var(--warning, #F5C26B)'
      : slot.status === 'completed'
        ? 'var(--success, #4ADE80)'
        : 'var(--danger, #FF6E6E)'

  return (
    <Modal open={true} onClose={onClose} title={slot.title || 'Дело'} size="md">
      <p style={subStyle}>
        {row.startLabel}–{row.endLabel} ·{' '}
        <span style={{ color: statusColor }}>{statusLabel}</span>
      </p>

        {slot.body ? (
          <div style={bodyStyle} data-testid="personal-event-body-view">
            {slot.body}
          </div>
        ) : (
          <p style={emptyStyle}>Без заметки.</p>
        )}

        {err ? <p style={errStyle}>{err}</p> : null}

        <div style={actionsStyle}>
          {isActive ? (
            <>
              <button
                type="button"
                onClick={() => call('cancel')}
                disabled={busy}
                style={dangerBtnStyle}
                data-testid="personal-event-cancel-action-btn"
              >
                Отменить дело
              </button>
              <button
                type="button"
                onClick={() => call('complete')}
                disabled={busy}
                style={successBtnStyle}
                data-testid="personal-event-complete-btn"
              >
                ✓ Выполнено
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              style={ghostBtnStyle}
            >
              Закрыть
            </button>
          )}
        </div>
    </Modal>
  )
}

const scrimStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.55)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 100,
  padding: 16,
}

const cardStyle: React.CSSProperties = {
  background: 'var(--surface-1, #141416)',
  border: '1px solid var(--border)',
  borderRadius: 14,
  padding: 24,
  maxWidth: 480,
  width: '100%',
  boxShadow: '0 32px 64px rgba(0,0,0,0.4)',
}

const titleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 20,
  fontWeight: 700,
  letterSpacing: '-0.01em',
  color: 'var(--text)',
}

const subStyle: React.CSSProperties = {
  color: 'var(--secondary)',
  fontSize: 13,
  marginTop: 6,
  marginBottom: 16,
}

const bodyStyle: React.CSSProperties = {
  background: 'var(--surface-2, #1c1c1f)',
  border: '1px solid var(--border)',
  borderRadius: 10,
  padding: 14,
  fontSize: 14,
  color: 'var(--text)',
  whiteSpace: 'pre-wrap',
  lineHeight: 1.6,
  marginBottom: 16,
}

const emptyStyle: React.CSSProperties = {
  color: 'var(--text-tertiary, var(--secondary))',
  fontSize: 13,
  fontStyle: 'italic',
  marginBottom: 16,
}

const errStyle: React.CSSProperties = {
  color: 'var(--danger)',
  fontSize: 13,
  marginBottom: 12,
}

const actionsStyle: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  justifyContent: 'flex-end',
  marginTop: 18,
  flexWrap: 'wrap',
}

const btnBaseStyle: React.CSSProperties = {
  padding: '10px 18px',
  borderRadius: 8,
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  border: 0,
}

const successBtnStyle: React.CSSProperties = {
  ...btnBaseStyle,
  background: 'transparent',
  color: 'var(--success, #4ADE80)',
  border: '1px solid var(--success, #4ADE80)',
}

const dangerBtnStyle: React.CSSProperties = {
  ...btnBaseStyle,
  background: 'transparent',
  color: 'var(--danger)',
  border: '1px solid var(--danger)',
}

const ghostBtnStyle: React.CSSProperties = {
  ...btnBaseStyle,
  background: 'transparent',
  color: 'var(--secondary)',
  border: '1px solid var(--border)',
}
