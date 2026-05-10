'use client'

import { useState } from 'react'

import type { CalendarRow } from '@/lib/calendar/view-model'

// Wave A PR3 — slot detail modal launched from calendar click. Read
// fields from the discriminated `kind`; show cancel button only on
// open / booked-full slots (admin can cancel either).

export type SlotCancelModalProps = {
  row: CalendarRow
  // Wave 14.1 — operator can also assign a learner to an open slot
  // straight from the calendar (without switching to the list tab).
  // The candidate list is pre-filtered (verified, not disabled, not
  // admin) by the parent; this component additionally filters out
  // the current calendar's teacher to prevent self-booking offers.
  learnerCandidates?: Array<{ id: string; email: string }>
  currentTeacherId?: string
  onClose: () => void
  onCancelled: () => void
  onAssigned?: () => void
}

export function SlotCancelModal({
  row,
  learnerCandidates,
  currentTeacherId,
  onClose,
  onCancelled,
  onAssigned,
}: SlotCancelModalProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [pickedLearnerEmail, setPickedLearnerEmail] = useState('')

  const slot = row.slot
  const canCancel =
    slot.kind === 'open' || slot.kind === 'booked-full' || slot.kind === 'booked-self'
  const canAssign = slot.kind === 'open'
  const slotId = 'id' in slot ? slot.id : null

  // Pre-filter candidates for the open-slot assign action: never
  // offer the slot's own teacher as a learner (lib/scheduling/slots.ts
  // bookSlot rejects self-booking; UI matches that contract). When
  // currentTeacherId isn't passed, fall back to the unfiltered list.
  const eligibleLearners = (learnerCandidates ?? []).filter(
    (l) => !currentTeacherId || l.id !== currentTeacherId,
  )

  async function handleAssign() {
    if (!slotId || !pickedLearnerEmail.trim() || !onAssigned) return
    setBusy(true)
    setError(null)
    try {
      const r = await fetch(`/api/admin/slots/${slotId}/book-as-operator`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ learnerEmail: pickedLearnerEmail.trim() }),
      })
      if (!r.ok) {
        const body = await r.json().catch(() => ({}))
        throw new Error(body.error || `HTTP ${r.status}`)
      }
      onAssigned()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function handleCancel() {
    if (!slotId) return
    setBusy(true)
    setError(null)
    try {
      const r = await fetch(`/api/admin/slots/${slotId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() || null }),
      })
      if (!r.ok) {
        const body = await r.json().catch(() => ({}))
        throw new Error(body.error || `HTTP ${r.status}`)
      }
      onCancelled()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="slot-modal-title"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#1f1f23',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 12,
          padding: 24,
          minWidth: 360,
          maxWidth: 480,
          color: '#e4e4e7',
        }}
      >
        <h2 id="slot-modal-title" style={{ fontSize: 18, marginBottom: 12 }}>
          Слот {row.startLabel} – {row.endLabel}
        </h2>
        <dl style={{ fontSize: 13, color: '#9ca3af', lineHeight: 1.7 }}>
          <DescRow label="Дата" value={row.dayYmd} />
          <DescRow label="Длительность" value={`${slot.durationMinutes} мин`} />
          <DescRow label="Статус" value={statusLabel(slot.kind)} />
          {'learnerEmail' in slot && slot.learnerEmail ? (
            <DescRow label="Учащийся" value={slot.learnerEmail} />
          ) : null}
          {'tariffAmountKopecks' in slot &&
          slot.tariffAmountKopecks !== null &&
          slot.tariffAmountKopecks !== undefined ? (
            <DescRow
              label="Тариф"
              value={`${(slot.tariffAmountKopecks / 100).toLocaleString('ru-RU')} ₽`}
            />
          ) : null}
        </dl>

        {canAssign && eligibleLearners.length > 0 && onAssigned ? (
          <div style={{ marginTop: 20 }}>
            <label
              style={{
                display: 'block',
                fontSize: 12,
                color: '#9ca3af',
                marginBottom: 6,
              }}
            >
              Привязать ученика:
            </label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <select
                value={pickedLearnerEmail}
                onChange={(e) => setPickedLearnerEmail(e.target.value)}
                style={{
                  flex: 1,
                  minWidth: 220,
                  padding: '8px 12px',
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 6,
                  color: '#e4e4e7',
                  fontSize: 13,
                  boxSizing: 'border-box',
                }}
              >
                <option value="">— выберите ученика —</option>
                {eligibleLearners.map((l) => (
                  <option key={l.id} value={l.email}>
                    {l.email}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={handleAssign}
                disabled={busy || !pickedLearnerEmail.trim()}
                style={{
                  padding: '8px 16px',
                  background: 'rgba(34, 197, 94, 0.18)',
                  border: '1px solid rgba(34, 197, 94, 0.55)',
                  borderRadius: 6,
                  color: '#bbf7d0',
                  cursor:
                    busy || !pickedLearnerEmail.trim() ? 'not-allowed' : 'pointer',
                  fontSize: 13,
                  fontWeight: 600,
                  opacity: busy || !pickedLearnerEmail.trim() ? 0.6 : 1,
                }}
              >
                {busy ? 'Назначаем…' : 'Назначить'}
              </button>
            </div>
          </div>
        ) : null}

        {canCancel ? (
          <div style={{ marginTop: 20 }}>
            <label
              style={{
                display: 'block',
                fontSize: 12,
                color: '#9ca3af',
                marginBottom: 6,
              }}
            >
              Причина отмены (необязательно):
            </label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={200}
              style={{
                width: '100%',
                padding: '8px 12px',
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 6,
                color: '#e4e4e7',
                fontSize: 13,
                boxSizing: 'border-box',
              }}
              placeholder="Например: учитель заболел"
            />
          </div>
        ) : null}

        {error ? (
          <div
            role="alert"
            style={{
              marginTop: 16,
              padding: 12,
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              borderRadius: 6,
              color: '#fecaca',
              fontSize: 13,
            }}
          >
            {error}
          </div>
        ) : null}

        <div
          style={{
            display: 'flex',
            gap: 8,
            justifyContent: 'flex-end',
            marginTop: 20,
          }}
        >
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            style={{
              padding: '8px 16px',
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 6,
              color: '#e4e4e7',
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            Закрыть
          </button>
          {canCancel ? (
            <button
              type="button"
              onClick={handleCancel}
              disabled={busy}
              style={{
                padding: '8px 16px',
                background: 'rgba(239, 68, 68, 0.15)',
                border: '1px solid rgba(239, 68, 68, 0.5)',
                borderRadius: 6,
                color: '#fecaca',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              {busy ? 'Отменяем…' : 'Отменить слот'}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function DescRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', gap: 12 }}>
      <dt style={{ minWidth: 100, color: '#71717a' }}>{label}:</dt>
      <dd>{value}</dd>
    </div>
  )
}

function statusLabel(kind: CalendarRow['slot']['kind']): string {
  switch (kind) {
    case 'open': return 'Доступен'
    case 'booked-self': return 'Ваш слот'
    case 'booked-other': return 'Занято'
    case 'booked-full': return 'Забронирован'
    case 'past-full':
    case 'past-redacted': return 'Прошедший'
  }
}
