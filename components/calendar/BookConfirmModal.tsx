'use client'

import { useState } from 'react'

import type { CalendarRow } from '@/lib/calendar/view-model'

// Wave B PR1 — learner-side click-to-book modal launched from the
// calendar. Reuses the existing POST /api/slots/[id]/book endpoint;
// the modal only renders details + a Book button when the slot kind
// is `open`. Other kinds (booked-self / booked-other / past-redacted)
// render read-only details with a hint pointing to «Мои уроки» for
// cancellation (Codex 2026-05-08 Wave B design: NO cancel surface
// inside the calendar — keeps 24h-rule ownership in one place).
//
// Wave B post-review — Codex flagged the calendar grid renders in
// MSK while non-MSK learners see "wrong" wall times. Pragmatic fix
// for v1: the grid stays in MSK (canonical for the teacher's
// schedule), and this modal shows the slot in BOTH MSK and the
// learner's display tz so they can confirm the actual local time
// before committing. Long-term: thread tz through view-model.

export type BookConfirmModalProps = {
  row: CalendarRow
  emailVerified: boolean
  // Learner's display tz (from `account_profiles.timezone`). When
  // it differs from MSK, the modal shows both wall times.
  learnerTimezone: string
  onClose: () => void
  // Fired on 200 (success) — parent runs refetch + close.
  onBooked: () => void
  // Fired on 409 race (slot_taken / slot_not_open) — parent runs
  // refetch so the calendar no longer shows the slot as `open`.
  // Modal stays mounted so the user sees the inline error; they
  // close manually.
  onConflict: () => void
}

export function BookConfirmModal({
  row,
  emailVerified,
  learnerTimezone,
  onClose,
  onBooked,
  onConflict,
}: BookConfirmModalProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const slot = row.slot
  const canBook = slot.kind === 'open' && 'id' in slot && slot.id !== undefined

  // Codex Wave B post-review: surface the slot wall time in BOTH
  // MSK (canonical teacher schedule) AND the learner's local tz so
  // they confirm the right hour before booking. Skip the local
  // line when the learner's tz matches MSK (avoids redundancy).
  const showLearnerTz =
    learnerTimezone && learnerTimezone !== 'Europe/Moscow'
  const localStart = showLearnerTz
    ? formatHhmmInTz(slot.startAt, learnerTimezone)
    : null
  const localEnd = showLearnerTz
    ? formatHhmmInTz(
        new Date(
          new Date(slot.startAt).getTime() + slot.durationMinutes * 60_000,
        ).toISOString(),
        learnerTimezone,
      )
    : null

  async function handleBook() {
    if (!canBook) return
    if (!emailVerified) {
      setError('Подтвердите e-mail, чтобы записаться на занятие.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/slots/${slot.id}/book`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        if (body?.error === 'email_not_verified') {
          throw new Error('Подтвердите e-mail, чтобы записаться.')
        }
        if (body?.error === 'slot_taken' || body?.error === 'slot_not_open') {
          // Codex Wave B post-review: 409 is a normal race. Trigger
          // parent refetch so the calendar no longer shows this
          // slot as `open`. Modal stays mounted so the inline error
          // tells the user what happened; they close manually.
          onConflict()
          throw new Error('Этот слот только что занят. Попробуйте другой.')
        }
        throw new Error(body?.message || body?.error || `HTTP ${res.status}`)
      }
      onBooked()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const isBookedSelf = slot.kind === 'booked-self'

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="book-confirm-title"
      onClick={busy ? undefined : onClose}
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
          minWidth: 320,
          maxWidth: 440,
          color: '#e4e4e7',
        }}
      >
        <h2 id="book-confirm-title" style={{ fontSize: 18, marginBottom: 12 }}>
          Слот {row.startLabel} – {row.endLabel}{' '}
          <span style={{ fontSize: 12, color: '#71717a', fontWeight: 400 }}>
            (МСК)
          </span>
        </h2>
        <dl style={{ fontSize: 13, color: '#9ca3af', lineHeight: 1.7 }}>
          <Row label="Дата" value={row.dayYmd} />
          {showLearnerTz && localStart && localEnd ? (
            <Row
              label="Ваше время"
              value={`${localStart} – ${localEnd} (${learnerTimezone})`}
            />
          ) : null}
          <Row label="Длительность" value={`${slot.durationMinutes} мин`} />
          <Row label="Статус" value={statusLabel(slot.kind)} />
          {'tariffAmountKopecks' in slot &&
          slot.tariffAmountKopecks !== null &&
          slot.tariffAmountKopecks !== undefined ? (
            <Row
              label="Стоимость"
              value={`${(slot.tariffAmountKopecks / 100).toLocaleString('ru-RU')} ₽`}
            />
          ) : null}
        </dl>

        {isBookedSelf ? (
          <p
            style={{
              color: '#9ca3af',
              fontSize: 12,
              marginTop: 16,
              lineHeight: 1.5,
            }}
          >
            Это ваш слот. Отменить запись можно в разделе «Мои уроки» —
            не позднее, чем за 24 часа до начала.
          </p>
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
            style={btnSecondary}
          >
            Закрыть
          </button>
          {canBook ? (
            <button
              type="button"
              onClick={handleBook}
              disabled={busy || !emailVerified}
              style={
                emailVerified ? btnPrimary : { ...btnPrimary, opacity: 0.5 }
              }
              title={
                emailVerified
                  ? undefined
                  : 'Подтвердите e-mail, чтобы записаться'
              }
            >
              {busy ? 'Записываем…' : 'Записаться'}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', gap: 12 }}>
      <dt style={{ minWidth: 100, color: '#71717a' }}>{label}:</dt>
      <dd>{value}</dd>
    </div>
  )
}

function formatHhmmInTz(iso: string, tz: string): string {
  try {
    return new Date(iso).toLocaleString('ru-RU', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
  } catch {
    // Defensive fallback if the tz name is malformed (shouldn't
    // happen — `account_profiles.timezone` is allowlist-validated).
    return new Date(iso).toLocaleString('ru-RU', {
      timeZone: 'Europe/Moscow',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
  }
}

function statusLabel(kind: CalendarRow['slot']['kind']): string {
  switch (kind) {
    case 'open':
      return 'Свободен'
    case 'booked-self':
      return 'Ваш слот'
    case 'booked-other':
      return 'Занято'
    case 'booked-full':
      return 'Забронирован'
    case 'past-full':
    case 'past-redacted':
      return 'Прошедший'
  }
}

const btnSecondary: React.CSSProperties = {
  padding: '8px 16px',
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 6,
  color: '#e4e4e7',
  cursor: 'pointer',
  fontSize: 13,
}

const btnPrimary: React.CSSProperties = {
  padding: '8px 16px',
  background: 'rgba(34, 197, 94, 0.18)',
  border: '1px solid rgba(34, 197, 94, 0.55)',
  borderRadius: 6,
  color: '#bbf7d0',
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 600,
}
