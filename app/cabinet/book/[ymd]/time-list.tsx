'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

// BCS-B.frontend — Calendly screen 2 client island. Fetches
// /api/slots/booking-times for the given (ymd, tz) and renders the
// list of available start times. Click → navigate to confirm screen.

type PublicSlot = {
  id: string
  startAt: string
  durationMinutes: number
  status: string
}

function formatTime(iso: string, tz: string): string {
  return new Date(iso).toLocaleTimeString('ru-RU', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function TimeList({ ymd, tz }: { ymd: string; tz: string }) {
  const router = useRouter()
  const [slots, setSlots] = useState<PublicSlot[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    const q = new URLSearchParams({ ymd, tz }).toString()
    fetch(`/api/slots/booking-times?${q}`, { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}))
          throw new Error(body.message || body.error || `HTTP ${r.status}`)
        }
        return r.json() as Promise<{ slots: PublicSlot[] }>
      })
      .then((data) => {
        if (!cancelled) setSlots(data.slots ?? [])
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [ymd, tz])

  if (loading) {
    return (
      <p
        style={{
          color: 'var(--secondary)',
          fontSize: 13,
          textAlign: 'center',
        }}
      >
        Загружаем время…
      </p>
    )
  }
  if (error) {
    return (
      <p style={{ color: '#ff8a8a', fontSize: 13, textAlign: 'center' }}>
        Не удалось загрузить: {error}
      </p>
    )
  }
  if (slots.length === 0) {
    return (
      <p
        style={{
          color: 'var(--secondary)',
          fontSize: 13,
          textAlign: 'center',
        }}
      >
        На эту дату свободного времени нет.
      </p>
    )
  }

  return (
    <ul
      style={{
        listStyle: 'none',
        padding: 0,
        margin: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      {slots.map((slot) => (
        <li key={slot.id}>
          <button
            type="button"
            onClick={() => router.push(`/cabinet/book/${ymd}/${slot.id}`)}
            style={{
              width: '100%',
              padding: '12px 16px',
              background: 'transparent',
              border: '1px solid var(--accent, #3b82f6)',
              borderRadius: 8,
              color: 'var(--accent, #3b82f6)',
              fontSize: 16,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {formatTime(slot.startAt, tz)}
          </button>
        </li>
      ))}
    </ul>
  )
}
