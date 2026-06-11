'use client'

import { useState } from 'react'

import type { CalendarSlotMode } from '@/lib/scheduling/slot-mode'

// teacher-no-slots-mode (Задача 2.1, Sub-PR A, 2026-06-11).
// Global mode toggle: 'open_slots' (default — ученики бронируют слоты) /
// 'direct_assign' (учитель сам назначает каждому). Lives below the
// Google Calendar block on /teacher/settings/calendar.

export function SlotModeToggle({
  initialMode,
}: {
  initialMode: CalendarSlotMode
}) {
  const [mode, setMode] = useState<CalendarSlotMode>(initialMode)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  async function handleChange(next: CalendarSlotMode) {
    if (next === mode || busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/teacher/settings/calendar/slot-mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: next }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(
          typeof body?.error === 'string'
            ? `Не удалось сохранить (${body.error})`
            : `Не удалось сохранить (HTTP ${res.status})`,
        )
        return
      }
      setMode(next)
      setToast(
        next === 'direct_assign'
          ? 'Режим «Я сам назначаю» включён.'
          : 'Режим «Ученики бронируют слоты» включён.',
      )
      setTimeout(() => setToast(null), 3500)
    } catch (e) {
      setError(
        `Сеть недоступна: ${e instanceof Error ? e.message : String(e)}`,
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      style={{
        marginTop: 24,
        padding: 24,
        background: 'var(--surface-2, rgba(255,255,255,0.03))',
        border: '1px solid var(--border)',
        borderRadius: 12,
      }}
    >
      <h2 style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 600 }}>
        Как вы назначаете занятия
      </h2>
      <p
        style={{
          margin: '0 0 16px',
          color: 'var(--text-secondary, var(--secondary))',
          fontSize: 14,
          lineHeight: 1.5,
        }}
      >
        Выберите, как ученики попадают в ваше расписание. В любой момент можно
        переключить обратно.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <ModeOption
          value="open_slots"
          checked={mode === 'open_slots'}
          onSelect={handleChange}
          disabled={busy}
          title="Ученики выбирают свободное время"
          body="Вы открываете часы в расписании. Ученики сами выбирают время из доступных. Подходит, если хотите собирать заявки автоматически."
        />
        <ModeOption
          value="direct_assign"
          checked={mode === 'direct_assign'}
          onSelect={handleChange}
          disabled={busy}
          title="Я сам назначаю время каждому"
          body="Свободные часы выставлять не нужно. Вы выбираете ученика, время и тариф вручную для каждого занятия. Ученик получает письмо. Подходит для регулярных учеников."
        />
      </div>

      {error ? (
        <div
          role="alert"
          style={{
            marginTop: 12,
            padding: 10,
            background: 'var(--danger-bg)',
            color: 'var(--danger)',
            border: '1px solid var(--danger)',
            borderRadius: 8,
            fontSize: 13,
          }}
        >
          {error}
        </div>
      ) : null}

      {toast ? (
        <div
          role="status"
          style={{
            marginTop: 12,
            padding: 10,
            background: 'var(--success-bg)',
            color: 'var(--success)',
            border: '1px solid var(--success)',
            borderRadius: 8,
            fontSize: 13,
          }}
        >
          {toast}
        </div>
      ) : null}
    </section>
  )
}

function ModeOption({
  value,
  checked,
  onSelect,
  disabled,
  title,
  body,
}: {
  value: CalendarSlotMode
  checked: boolean
  onSelect: (next: CalendarSlotMode) => void
  disabled: boolean
  title: string
  body: string
}) {
  return (
    <label
      style={{
        display: 'flex',
        gap: 12,
        padding: 16,
        background: checked ? 'var(--accent-bg)' : 'var(--surface-1)',
        border: `1px solid ${checked ? 'var(--accent)' : 'var(--border)'}`,
        borderRadius: 10,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.7 : 1,
      }}
    >
      <input
        type="radio"
        name="calendar-slot-mode"
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={() => onSelect(value)}
        style={{ marginTop: 3, accentColor: 'var(--accent)' }}
      />
      <div style={{ flex: 1 }}>
        <div
          style={{
            fontSize: 15,
            fontWeight: 600,
            color: 'var(--text-primary, var(--text))',
          }}
        >
          {title}
        </div>
        <div
          style={{
            fontSize: 13,
            color: 'var(--text-secondary, var(--secondary))',
            marginTop: 4,
            lineHeight: 1.5,
          }}
        >
          {body}
        </div>
      </div>
    </label>
  )
}
