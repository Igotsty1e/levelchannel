'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

// BCS-B.frontend — Calendly screen 2 client island. Fetches
// /api/slots/booking-times for the given (ymd, tz) and renders the
// list of available start times. Click → navigate to confirm screen.

// Bug #3 fix (2026-06-02) — extended local PublicSlot shape with the
// optional `tariffTitleRu` field already served by /api/slots/booking-
// times (see `lib/scheduling/slots/types.ts:153-175`). Used to render
// the real per-slot tariff title alongside the start time + duration,
// replacing the hardcoded title + duration placeholders.
type PublicSlot = {
  id: string
  startAt: string
  durationMinutes: number
  status: string
  tariffTitleRu?: string | null
}

function formatTime(iso: string, tz: string): string {
  return new Date(iso).toLocaleTimeString('ru-RU', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function TimeList({
  ymd,
  tz,
  // SAAS-PIVOT Day 2 (2026-05-22) — forwarded from /cabinet/book/[ymd]
  // page (sourced from getActiveTeacherForLearner + first-link
  // fallback for multi-link learners). Threaded into the booking-times
  // fetch + the confirm-screen link so the whole flow is teacher-
  // scoped end-to-end.
  teacherAccountId,
}: {
  ymd: string
  tz: string
  teacherAccountId?: string | null
}) {
  const router = useRouter()
  const [slots, setSlots] = useState<PublicSlot[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    const qParams: Record<string, string> = { ymd, tz }
    if (teacherAccountId) qParams.teacher = teacherAccountId
    const q = new URLSearchParams(qParams).toString()
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
  }, [ymd, tz, teacherAccountId])

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
      {slots.map((slot) => {
        // Bug #3 fix (2026-06-02) — render real per-slot tariff title +
        // duration alongside the start time. Canonical null-fallback
        // contract per plan-doc §Screen 2: when `tariffTitleRu === null`
        // (legacy pre-tariff-binding slots from before mig 0022, or
        // slots created without a tariffId), drop the title from the
        // suffix entirely — no literal placeholder.
        const title = slot.tariffTitleRu?.trim() ?? null
        const suffix = title
          ? `${slot.durationMinutes} мин · ${title}`
          : `${slot.durationMinutes} мин`
        return (
          <li key={slot.id}>
            <button
              type="button"
              onClick={() => {
                const next = teacherAccountId
                  ? `/cabinet/book/${ymd}/${slot.id}?teacher=${encodeURIComponent(teacherAccountId)}`
                  : `/cabinet/book/${ymd}/${slot.id}`
                router.push(next)
              }}
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
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 2,
              }}
            >
              <span>{formatTime(slot.startAt, tz)}</span>
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 400,
                  color: 'var(--secondary)',
                }}
              >
                {suffix}
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
