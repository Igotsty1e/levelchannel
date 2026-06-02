'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import type { OrphanSlotRow } from '@/lib/calendar/orphan-cleanup'

// BCS-G.4 — client island for the orphan-self cleanup section.
// Server component (page.tsx) hands the initial list down via props;
// client island carries the busy-state + per-row + "ignore all"
// actions. After a successful POST we call router.refresh() so the
// server component re-renders without the cleared rows.

type Props = {
  initialSlots: OrphanSlotRow[]
}

function fmtRu(iso: string): string {
  try {
    return new Date(iso).toLocaleString('ru-RU', {
      timeZone: 'Europe/Moscow',
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

export function OrphanSection({ initialSlots }: Props) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function ignoreOne(slotId: string) {
    if (busy) return
    setBusy(slotId)
    setError(null)
    try {
      const res = await fetch('/api/teacher/calendar/orphan-slots/ignore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slotId }),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          message?: string
          error?: string
        }
        setError(data.message || data.error || `Ошибка ${res.status}`)
      } else {
        router.refresh()
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Сетевая ошибка')
    } finally {
      setBusy(null)
    }
  }

  async function ignoreAll() {
    if (busy) return
    if (!confirm(`Очистить устаревшие связи на ${initialSlots.length} занятиях?`)) {
      return
    }
    setBusy('all')
    setError(null)
    try {
      const res = await fetch('/api/teacher/calendar/orphan-slots/ignore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ all: true }),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          message?: string
          error?: string
        }
        setError(data.message || data.error || `Ошибка ${res.status}`)
      } else {
        router.refresh()
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Сетевая ошибка')
    } finally {
      setBusy(null)
    }
  }

  if (initialSlots.length === 0) return null

  return (
    <section
      style={{
        marginTop: 24,
        padding: 20,
        background: 'rgba(255, 196, 0, 0.06)',
        border: '1px solid rgba(255, 209, 102, 0.35)',
        borderRadius: 12,
      }}
    >
      <h2
        style={{
          fontSize: 16,
          fontWeight: 600,
          margin: '0 0 8px 0',
          color: '#ffd166',
        }}
      >
        🧹 Устаревшие связи с Google Calendar ({initialSlots.length})
      </h2>
      <p
        style={{
          color: 'var(--secondary)',
          fontSize: 13,
          margin: '0 0 16px 0',
          lineHeight: 1.6,
        }}
      >
        Эти занятия были связаны с событиями в Google в прошлой
        интеграции (до того, как вы переподключили календарь). События
        в Google остались — это нормально, они ваши. Нажав
        «Очистить связь», вы только разорвёте локальную ссылку: занятие
        в LevelChannel перестанет ссылаться на старое событие, но
        само событие в Google останется, и вы сможете удалить его
        вручную из календаря, если оно больше не нужно.
      </p>

      {error ? (
        <p
          role="alert"
          style={{ color: '#ff8a8a', fontSize: 13, marginBottom: 12 }}
        >
          {error}
        </p>
      ) : null}

      <button
        type="button"
        onClick={ignoreAll}
        disabled={busy !== null}
        style={{
          padding: '8px 14px',
          background: 'rgba(255, 209, 102, 0.15)',
          color: '#ffd166',
          border: '1px solid rgba(255, 209, 102, 0.4)',
          borderRadius: 6,
          fontSize: 13,
          fontWeight: 500,
          cursor: busy !== null ? 'not-allowed' : 'pointer',
          opacity: busy !== null ? 0.6 : 1,
          marginBottom: 16,
        }}
      >
        {busy === 'all' ? 'Очищаем…' : 'Очистить связь у всех'}
      </button>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {initialSlots.map((s) => (
          <div
            key={s.slotId}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '8px 12px',
              background: 'rgba(255,255,255,0.02)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              fontSize: 13,
            }}
          >
            <div>
              <strong style={{ color: 'var(--text)' }}>{fmtRu(s.startAt)} МСК</strong>{' '}
              · {s.durationMinutes} мин · {s.status}
              <div
                style={{
                  color: 'var(--secondary)',
                  fontSize: 11,
                  marginTop: 2,
                }}
              >
                календарь: {s.externalCalendarId}, событие:{' '}
                {s.externalEventId.length > 24
                  ? s.externalEventId.slice(0, 24) + '…'
                  : s.externalEventId}
              </div>
            </div>
            <button
              type="button"
              onClick={() => ignoreOne(s.slotId)}
              disabled={busy !== null}
              style={{
                padding: '4px 10px',
                background: 'transparent',
                color: 'var(--text)',
                border: '1px solid var(--border)',
                borderRadius: 5,
                fontSize: 12,
                cursor: busy !== null ? 'not-allowed' : 'pointer',
                opacity: busy === s.slotId || busy !== null ? 0.6 : 1,
              }}
            >
              {busy === s.slotId ? 'Очищаем…' : 'Очистить связь'}
            </button>
          </div>
        ))}
      </div>
    </section>
  )
}
