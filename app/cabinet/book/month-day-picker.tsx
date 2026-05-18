'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'

// BCS-B.frontend — month grid client island for Calendly screen 1.
//
// Fetches /api/slots/booking-days for the visible month, paints
// "available" pills on days with ≥1 open slot, navigates to
// /cabinet/book/<ymd> on tap.
//
// Month nav: prev / next buttons that step by one calendar month.
// The user's tz drives day grouping at the API boundary; the visible
// "month" here is computed in the user's tz.

const WEEKDAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']
const MONTH_NAMES = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
]

function ymd(y: number, m: number, d: number): string {
  const mm = String(m + 1).padStart(2, '0')
  const dd = String(d).padStart(2, '0')
  return `${y}-${mm}-${dd}`
}

// Returns the grid of dates (with prev/next month spillover) for a
// given (year, monthIdx 0-11) anchored on Monday. Each cell is either
// a Date in the current month or null (spillover dimmed in render).
function buildMonthGrid(year: number, monthIdx: number): (Date | null)[] {
  const firstOfMonth = new Date(Date.UTC(year, monthIdx, 1))
  // Monday=0 .. Sunday=6 (rotate JS getUTCDay where Sun=0)
  const startDow = (firstOfMonth.getUTCDay() + 6) % 7
  const lastOfMonth = new Date(Date.UTC(year, monthIdx + 1, 0))
  const daysInMonth = lastOfMonth.getUTCDate()
  const cells: (Date | null)[] = []
  for (let i = 0; i < startDow; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(new Date(Date.UTC(year, monthIdx, d)))
  }
  while (cells.length % 7 !== 0) cells.push(null)
  return cells
}

export function MonthDayPicker({ tz }: { tz: string }) {
  const router = useRouter()
  const today = useMemo(() => new Date(), [])
  const [view, setView] = useState({
    year: today.getFullYear(),
    monthIdx: today.getMonth(),
  })
  const [availableDays, setAvailableDays] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    // Pad ±1 day around the visible month so the API range covers
    // spillover-clickable boundaries cleanly. Most months fit in 35
    // cells, this is safety against tz-edge cases.
    const fromYmd = ymd(view.year, view.monthIdx, 1)
    const lastDay = new Date(Date.UTC(view.year, view.monthIdx + 1, 0))
    const toYmd = ymd(
      lastDay.getUTCFullYear(),
      lastDay.getUTCMonth(),
      lastDay.getUTCDate(),
    )
    const q = new URLSearchParams({
      from: fromYmd,
      to: toYmd,
      tz,
    }).toString()
    fetch(`/api/slots/booking-days?${q}`, { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}))
          throw new Error(body.message || body.error || `HTTP ${r.status}`)
        }
        return r.json() as Promise<{ days: string[] }>
      })
      .then((data) => {
        if (!cancelled) setAvailableDays(new Set(data.days))
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
  }, [view.year, view.monthIdx, tz])

  const grid = buildMonthGrid(view.year, view.monthIdx)

  const handlePrev = () => {
    setView((v) =>
      v.monthIdx === 0
        ? { year: v.year - 1, monthIdx: 11 }
        : { year: v.year, monthIdx: v.monthIdx - 1 },
    )
  }
  const handleNext = () => {
    setView((v) =>
      v.monthIdx === 11
        ? { year: v.year + 1, monthIdx: 0 }
        : { year: v.year, monthIdx: v.monthIdx + 1 },
    )
  }

  const todayYmd = ymd(today.getFullYear(), today.getMonth(), today.getDate())

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 16,
        }}
      >
        <button
          type="button"
          onClick={handlePrev}
          aria-label="Предыдущий месяц"
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            fontSize: 20,
            color: 'var(--accent, #3b82f6)',
            padding: '4px 8px',
          }}
        >
          ‹
        </button>
        <div style={{ fontSize: 16, fontWeight: 600 }}>
          {MONTH_NAMES[view.monthIdx]} {view.year}
        </div>
        <button
          type="button"
          onClick={handleNext}
          aria-label="Следующий месяц"
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            fontSize: 20,
            color: 'var(--accent, #3b82f6)',
            padding: '4px 8px',
          }}
        >
          ›
        </button>
      </div>

      <div
        role="grid"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(7, 1fr)',
          gap: 4,
        }}
      >
        {WEEKDAYS.map((w) => (
          <div
            key={w}
            role="columnheader"
            style={{
              fontSize: 11,
              color: 'var(--secondary)',
              textAlign: 'center',
              padding: '8px 0',
              letterSpacing: 0.4,
            }}
          >
            {w}
          </div>
        ))}
        {grid.map((cell, idx) => {
          if (!cell) {
            return <div key={idx} role="gridcell" aria-hidden="true" />
          }
          const cellYmd = ymd(
            cell.getUTCFullYear(),
            cell.getUTCMonth(),
            cell.getUTCDate(),
          )
          const isAvailable = availableDays.has(cellYmd)
          const isPast = cellYmd < todayYmd
          const isToday = cellYmd === todayYmd
          const day = cell.getUTCDate()
          return (
            <button
              key={cellYmd}
              type="button"
              role="gridcell"
              disabled={!isAvailable || isPast}
              onClick={() => router.push(`/cabinet/book/${cellYmd}`)}
              aria-label={`${day} ${MONTH_NAMES[view.monthIdx]}${isAvailable ? ', свободное время' : ''}`}
              style={{
                background: isAvailable && !isPast
                  ? 'rgba(59, 130, 246, 0.15)'
                  : 'transparent',
                border: isToday
                  ? '1px solid var(--accent, #3b82f6)'
                  : '1px solid transparent',
                borderRadius: '50%',
                width: 38,
                height: 38,
                margin: '0 auto',
                color: isPast
                  ? 'var(--secondary)'
                  : isAvailable
                    ? 'var(--accent, #3b82f6)'
                    : 'var(--text)',
                fontWeight: isAvailable && !isPast ? 600 : 400,
                fontSize: 14,
                cursor: isAvailable && !isPast ? 'pointer' : 'default',
                opacity: isPast ? 0.4 : 1,
              }}
            >
              {day}
            </button>
          )
        })}
      </div>

      {loading ? (
        <p
          style={{
            color: 'var(--secondary)',
            fontSize: 12,
            marginTop: 12,
            textAlign: 'center',
          }}
        >
          Загружаем расписание…
        </p>
      ) : null}
      {error ? (
        <p
          style={{
            color: '#ff8a8a',
            fontSize: 13,
            marginTop: 12,
            textAlign: 'center',
          }}
        >
          Не удалось загрузить дни: {error}
        </p>
      ) : !loading && availableDays.size === 0 ? (
        <p
          style={{
            color: 'var(--secondary)',
            fontSize: 13,
            marginTop: 12,
            textAlign: 'center',
          }}
        >
          На этот месяц свободного времени нет.
        </p>
      ) : null}
    </div>
  )
}
