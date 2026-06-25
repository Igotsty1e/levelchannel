'use client'

import { CSSProperties, useState } from 'react'

import { DatePicker, Modal, TimePicker } from '@/components/ui/primitives'
import type { CalendarRow } from '@/lib/calendar/view-model'

// teacher-reschedule-ui-wave-b (2026-06-16). Учитель переносит booked
// занятие ученика на новое время.
//
// POST /api/teacher/slots/[id]/reschedule с { newStartAt, reason }.
// Reason обязателен (min 5 chars) — ученик ждёт пояснения.
// Wave-A dispatch уведомит ученика email + TG после успешного commit.

export function RescheduleByTeacherModal({
  row,
  onClose,
  onSuccess,
}: {
  row: CalendarRow
  onClose: () => void
  onSuccess: (message: string) => void
}) {
  const slot = row.slot
  const slotId = 'id' in slot ? slot.id : null

  // Initial values: date = today, time = current slot time + 1 day later
  // (учитель чаще всего переносит на завтра / следующий доступный
  // момент). Если slot в прошлом — default today + 09:00 МСК.
  const initialIso = 'startAt' in slot ? slot.startAt : null
  const [date, setDate] = useState<string>(() => {
    if (!initialIso) return todayYmdMsk()
    const d = new Date(initialIso)
    // +1 day from original
    const next = new Date(d.getTime() + 24 * 60 * 60 * 1000)
    return ymdMsk(next)
  })
  const [time, setTime] = useState<string>(() => {
    if (!initialIso) return '09:00'
    return hhmmMsk(initialIso)
  })
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // ESC + backdrop + body scroll lock handled by Modal primitive.

  const reasonValid = reason.trim().length >= 5
  const canSubmit = !busy && reasonValid && date && time

  async function handleSubmit() {
    if (!slotId || !canSubmit) return
    setError(null)
    setBusy(true)
    try {
      const newStartIso = mskLocalToUtcIso(date, time)
      if (!newStartIso) {
        setError('Не получилось разобрать дату и время.')
        setBusy(false)
        return
      }
      const res = await fetch(`/api/teacher/slots/${slotId}/reschedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          newStartAt: newStartIso,
          reason: reason.trim(),
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(body.message || body.error || `HTTP ${res.status}`)
        setBusy(false)
        return
      }
      onSuccess('Занятие перенесено. Ученик получит уведомление.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не получилось перенести.')
      setBusy(false)
    }
  }

  const learnerLabel =
    'learnerEmail' in slot && slot.learnerEmail ? slot.learnerEmail : 'ученика'
  const wasWhen = row.startLabel
  const wasDate = formatDayYmdRu(row.dayYmd)

  return (
    <Modal open={true} onClose={onClose} busy={busy} title="Перенести занятие" size="lg">
      <p style={{ fontSize: 13, color: 'var(--secondary)', marginTop: 0 }}>
        Сейчас: {wasDate}, {wasWhen} · {learnerLabel}
      </p>

        <div style={{ marginTop: 16 }}>
          <label style={labelStyle}>Новая дата</label>
          <DatePicker
            value={date}
            onChange={setDate}
            disabled={busy}
            min={todayYmdMsk()}
            ariaLabel="Новая дата занятия"
          />
        </div>

        <div style={{ marginTop: 12 }}>
          <label style={labelStyle}>Новое время (МСК)</label>
          <TimePicker
            value={time}
            onChange={setTime}
            disabled={busy}
            hourMin={6}
            hourMax={22}
            ariaLabel="Новое время начала"
          />
        </div>

        <div style={{ marginTop: 16 }}>
          <label style={labelStyle}>
            Что сказать ученику (обязательно):
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            rows={3}
            placeholder="Например: не могу в это время, давайте перенесём на завтра"
            style={{
              width: '100%',
              padding: '8px 12px',
              background: 'var(--surface-2, rgba(255,255,255,0.05))',
              border: `1px solid ${
                reason.length > 0 && !reasonValid
                  ? 'var(--danger)'
                  : 'var(--border)'
              }`,
              borderRadius: 6,
              color: 'var(--text)',
              fontSize: 13,
              fontFamily: 'inherit',
              resize: 'vertical',
            }}
            disabled={busy}
          />
          <div
            style={{
              fontSize: 11,
              color: 'var(--secondary)',
              marginTop: 4,
            }}
          >
            Минимум 5 символов — ученику важно понять, что произошло.
          </div>
        </div>

        {error ? (
          <div role="alert" style={errorStyle}>
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
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            style={btnPrimary}
          >
            {busy ? 'Переносим…' : 'Перенести'}
          </button>
        </div>
    </Modal>
  )
}

// ─── helpers ─────────────────────────────────────────────────

function todayYmdMsk(): string {
  return ymdMsk(new Date())
}

function ymdMsk(d: Date): string {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  return dtf.format(d)
}

function hhmmMsk(iso: string): string {
  const dtf = new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  return dtf.format(new Date(iso))
}

function mskLocalToUtcIso(dateYmd: string, hhmm: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateYmd)
  const t = /^(\d{2}):(\d{2})$/.exec(hhmm)
  if (!m || !t) return null
  const [, y, mo, d] = m
  const [, hh, mm] = t
  const naiveUtc = Date.UTC(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(hh),
    Number(mm),
    0,
  )
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Europe/Moscow',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
    const parts = dtf.formatToParts(new Date(naiveUtc))
    const got: Record<string, string> = {}
    for (const p of parts) got[p.type] = p.value
    const gotUtc = Date.UTC(
      Number(got.year),
      Number(got.month) - 1,
      Number(got.day),
      Number(got.hour) % 24,
      Number(got.minute),
      0,
    )
    const diff = naiveUtc - gotUtc
    return new Date(naiveUtc + diff).toISOString()
  } catch {
    return null
  }
}

function formatDayYmdRu(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd)
  if (!m) return ymd
  const [, y, mo, d] = m
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)))
  const sameYear = new Date().getUTCFullYear() === Number(y)
  return new Intl.DateTimeFormat('ru-RU', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
    timeZone: 'UTC',
  }).format(date)
}

// ─── styles ──────────────────────────────────────────────────

const overlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.5)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
  padding: 16,
}

const sheetStyle: CSSProperties = {
  background: 'var(--surface-1, #1f1f23)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  padding: 24,
  minWidth: 360,
  maxWidth: 520,
  width: '100%',
  maxHeight: '90vh',
  overflowY: 'auto',
  color: 'var(--text)',
}

const labelStyle: CSSProperties = {
  display: 'block',
  fontSize: 13,
  color: 'var(--secondary)',
  marginBottom: 6,
}

const errorStyle: CSSProperties = {
  marginTop: 12,
  padding: 12,
  background: 'var(--danger-bg)',
  border: '1px solid var(--danger)',
  borderRadius: 6,
  color: 'var(--text)',
  fontSize: 13,
}

const btnSecondary: CSSProperties = {
  padding: '8px 16px',
  background: 'var(--surface-2, rgba(255,255,255,0.05))',
  border: '1px solid var(--border)',
  borderRadius: 6,
  color: 'var(--text)',
  cursor: 'pointer',
  fontSize: 13,
}

const btnPrimary: CSSProperties = {
  padding: '8px 16px',
  background: 'var(--accent)',
  border: '1px solid var(--accent)',
  borderRadius: 6,
  color: 'var(--text-on-accent, #fff)',
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 600,
}
