'use client'

import { useEffect, useState } from 'react'

import {
  type CalendarRow,
  groupSlotsByDay,
  weekDayKeys,
} from '@/lib/calendar/view-model'
import type { CalendarSlot } from '@/lib/calendar/types'

// Wave A — mobile fallback. When the calendar's container is too narrow
// to render 7 day columns, we render a compact day-grouped list of the
// SAME data. NOT the cabinet's existing list view — `/teacher` and
// `/admin/slots` calendar surfaces own their own mobile rendering.
//
// Wave B post-review — Codex flagged that this surface previously
// rendered `row.slot.kind` raw, exposing internal discriminator
// strings ("booked-self", "past-redacted") to learners on /cabinet.
// Same kindLabel mapping as SlotBlock so mobile and desktop agree.

function kindLabel(kind: string): string {
  switch (kind) {
    case 'open':
      return 'Доступен'
    case 'booked-self':
      return 'Ваше занятие'
    case 'booked-other':
      return 'Занято'
    case 'booked-full':
      return 'Забронировано'
    case 'past-full':
    case 'past-redacted':
      return 'Прошедшее'
    default:
      return kind
  }
}

const MIN_WEEK_VIEW_PX = 720

export type MobileFallbackProps = {
  fromYmd: string
  slots: ReadonlyArray<CalendarSlot>
  onSlotClick?: (row: CalendarRow) => void
}

// Hook that returns true when the host container is below the
// week-view threshold. Uses ResizeObserver on a sentinel element.
export function useNarrowContainer(ref: React.RefObject<HTMLElement | null>): boolean {
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        setNarrow(e.contentRect.width < MIN_WEEK_VIEW_PX)
      }
    })
    ro.observe(el)
    setNarrow(el.getBoundingClientRect().width < MIN_WEEK_VIEW_PX)
    return () => ro.disconnect()
  }, [ref])
  return narrow
}

export function MobileFallback({
  fromYmd,
  slots,
  onSlotClick,
}: MobileFallbackProps) {
  const days = weekDayKeys(fromYmd)
  const grouped = groupSlotsByDay(slots)

  return (
    <div role="list" aria-label="Слоты на неделю (мобильный список)">
      {days.map((ymd) => {
        const rows = grouped.get(ymd) || []
        if (rows.length === 0) return null
        return (
          <div
            key={ymd}
            style={{
              borderBottom: '1px solid rgba(255,255,255,0.06)',
              padding: '12px 0',
            }}
          >
            <div
              style={{
                fontSize: 12,
                color: '#9ca3af',
                marginBottom: 6,
                textTransform: 'uppercase',
                fontWeight: 600,
              }}
            >
              {ymd}
            </div>
            {rows.map((row, i) => (
              <button
                type="button"
                key={`${ymd}-${i}`}
                onClick={() => onSlotClick?.(row)}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '8px 12px',
                  margin: '4px 0',
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 6,
                  color: '#e4e4e7',
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                <strong>
                  {row.startLabel} – {row.endLabel}
                </strong>
                <span style={{ marginLeft: 8, color: '#9ca3af', fontSize: 12 }}>
                  {kindLabel(row.slot.kind)}
                </span>
              </button>
            ))}
          </div>
        )
      })}
    </div>
  )
}
