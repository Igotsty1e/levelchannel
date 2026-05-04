'use client'

import { useEffect, useState } from 'react'

import type { LessonSlot } from '@/lib/scheduling/slots'

type Props = {
  initialMine: LessonSlot[]
  initialAvailable: LessonSlot[]
  learnerTimezone: string | null
  emailVerified: boolean
}

const TZ_DEFAULT = 'Europe/Moscow'

function fmt(slotIso: string, tz: string): string {
  return new Date(slotIso).toLocaleString('ru-RU', {
    timeZone: tz,
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function statusLabel(status: string): string {
  switch (status) {
    case 'open':
      return 'свободен'
    case 'booked':
      return 'забронирован'
    case 'cancelled':
      return 'отменён'
    default:
      return status
  }
}

export function LessonsSection({
  initialMine,
  initialAvailable,
  learnerTimezone,
  emailVerified,
}: Props) {
  const tz = learnerTimezone ?? TZ_DEFAULT
  const [mine, setMine] = useState<LessonSlot[]>(initialMine)
  const [available, setAvailable] = useState<LessonSlot[]>(initialAvailable)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  async function refresh() {
    try {
      const [m, a] = await Promise.all([
        fetch('/api/slots/mine', { cache: 'no-store' }).then((r) => r.json()),
        fetch('/api/slots/available', { cache: 'no-store' }).then((r) => r.json()),
      ])
      setMine(m.slots ?? [])
      setAvailable(a.slots ?? [])
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'unknown')
    }
  }

  // Fresh-load on mount in case the learner just verified their email
  // in another tab — server-rendered lists could be stale.
  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function book(slotId: string) {
    setBusy(true)
    setErr(null)
    setInfo(null)
    try {
      const res = await fetch(`/api/slots/${slotId}/book`, { method: 'POST' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        if (data?.error === 'email_not_verified') {
          setErr('Подтвердите e-mail, чтобы записаться на занятие.')
        } else {
          setErr(data?.error || `HTTP ${res.status}`)
        }
        return
      }
      setInfo('Записано.')
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  async function cancel(slotId: string) {
    if (!confirm('Отменить запись?')) return
    setBusy(true)
    setErr(null)
    setInfo(null)
    try {
      const res = await fetch(`/api/slots/${slotId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: '' }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setErr(data?.error || `HTTP ${res.status}`)
        return
      }
      setInfo('Запись отменена.')
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="card" style={{ padding: 24, marginBottom: 24 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>
          Мои уроки
        </h2>
        {mine.length === 0 ? (
          <p style={{ color: 'var(--secondary)', fontSize: 14 }}>
            У вас пока нет записей. Запишитесь на свободный слот ниже.
          </p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {mine.map((s) => (
              <li
                key={s.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '10px 0',
                  borderTop: '1px solid var(--border)',
                  fontSize: 14,
                }}
              >
                <span>
                  {fmt(s.startAt, tz)} ·{' '}
                  <span style={{ color: 'var(--secondary)' }}>
                    {s.durationMinutes} мин · {statusLabel(s.status)}
                  </span>
                </span>
                {s.status === 'booked' &&
                new Date(s.startAt).getTime() > Date.now() ? (
                  <button
                    type="button"
                    onClick={() => cancel(s.id)}
                    disabled={busy}
                    style={{
                      padding: '4px 10px',
                      background: 'transparent',
                      color: '#ffcfcf',
                      border: '1px solid #ff8a8a55',
                      borderRadius: 6,
                      fontSize: 12,
                      cursor: busy ? 'wait' : 'pointer',
                    }}
                  >
                    Отменить
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card" style={{ padding: 24, marginBottom: 24 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>
          Записаться
        </h2>
        {!emailVerified ? (
          <p style={{ color: '#ffcfcf', fontSize: 13, marginBottom: 12 }}>
            Чтобы записаться, сначала подтвердите e-mail (см. баннер выше).
          </p>
        ) : null}
        {info ? (
          <p style={{ color: '#9bdf9b', fontSize: 13, marginBottom: 8 }}>{info}</p>
        ) : null}
        {err ? (
          <p style={{ color: '#ff8a8a', fontSize: 13, marginBottom: 8 }}>{err}</p>
        ) : null}
        {available.length === 0 ? (
          <p style={{ color: 'var(--secondary)', fontSize: 14 }}>
            Сейчас нет свободных слотов. Напишите оператору, чтобы добавил.
          </p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {available.map((s) => (
              <li
                key={s.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '10px 0',
                  borderTop: '1px solid var(--border)',
                  fontSize: 14,
                }}
              >
                <span>
                  {fmt(s.startAt, tz)} ·{' '}
                  <span style={{ color: 'var(--secondary)' }}>
                    {s.durationMinutes} мин
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => book(s.id)}
                  disabled={busy || !emailVerified}
                  style={{
                    padding: '4px 12px',
                    background: 'var(--accent)',
                    color: 'var(--accent-contrast)',
                    border: 'none',
                    borderRadius: 6,
                    fontSize: 12,
                    cursor: busy || !emailVerified ? 'not-allowed' : 'pointer',
                    opacity: busy || !emailVerified ? 0.6 : 1,
                  }}
                >
                  Записаться
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  )
}
