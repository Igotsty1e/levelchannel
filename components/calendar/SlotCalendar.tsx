'use client'

import { useEffect, useRef, useState } from 'react'

import type { CalendarResponse } from '@/lib/calendar/types'
import type { CalendarRow } from '@/lib/calendar/view-model'

import { Grid } from './Grid'
import { MobileFallback, useNarrowContainer } from './MobileFallback'
import { Toolbar } from './Toolbar'

// Wave A composition root. Read-only in PR2 (no paint, no move).
// PR3 will wire interaction layers; PR4 will route this against the
// `/teacher` surface.

export type SlotCalendarProps = {
  teacherId: string
  initialFromYmd: string
  // Click handler fires when user taps a slot. Parent can show a modal
  // with cancel / book buttons depending on the role.
  onSlotClick?: (row: CalendarRow) => void
}

export function SlotCalendar({
  teacherId,
  initialFromYmd,
  onSlotClick,
}: SlotCalendarProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const isNarrow = useNarrowContainer(containerRef)
  const [fromYmd, setFromYmd] = useState(initialFromYmd)
  const [response, setResponse] = useState<CalendarResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [reloadCounter, setReloadCounter] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    const toYmd = addDaysYmd(fromYmd, 7)
    fetch(
      `/api/slots/calendar?from=${fromYmd}&to=${toYmd}&teacherId=${teacherId}`,
      { headers: { Accept: 'application/json' } },
    )
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}))
          throw new Error(body.error || `HTTP ${r.status}`)
        }
        return r.json() as Promise<CalendarResponse>
      })
      .then((data) => {
        if (!cancelled) setResponse(data)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [teacherId, fromYmd, reloadCounter])

  const handlePrev = () => setFromYmd(addDaysYmd(fromYmd, -7))
  const handleNext = () => setFromYmd(addDaysYmd(fromYmd, 7))
  const handleToday = () => setFromYmd(initialFromYmd)
  const handleRefresh = () => setReloadCounter((n) => n + 1)

  return (
    <div ref={containerRef} className="slot-calendar">
      <Toolbar
        fromYmd={fromYmd}
        onPrev={handlePrev}
        onNext={handleNext}
        onToday={handleToday}
        onRefresh={handleRefresh}
        lastUpdatedAt={response ? new Date(response.generatedAt) : null}
        loading={loading}
      />
      {error ? (
        <div
          role="alert"
          style={{
            padding: 16,
            background: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: 8,
            color: '#fecaca',
          }}
        >
          Ошибка: {error}
        </div>
      ) : null}
      {response ? (
        isNarrow ? (
          <MobileFallback
            fromYmd={fromYmd}
            slots={response.slots}
            onSlotClick={onSlotClick}
          />
        ) : (
          <Grid
            fromYmd={fromYmd}
            slots={response.slots}
            onSlotClick={onSlotClick}
          />
        )
      ) : null}
    </div>
  )
}

function addDaysYmd(ymd: string, days: number): string {
  const [y, mo, d] = ymd.split('-').map(Number)
  const date = new Date(Date.UTC(y, mo - 1, d + days))
  return date.toISOString().slice(0, 10)
}
