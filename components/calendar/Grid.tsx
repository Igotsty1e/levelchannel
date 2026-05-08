'use client'

import {
  CALENDAR_GRID_DAY_HEIGHT_PX,
  CALENDAR_GRID_PX_PER_MIN,
} from '@/lib/calendar/dates'
import {
  type CalendarRow,
  groupSlotsByDay,
  timeAxisLabels,
  weekDayKeys,
} from '@/lib/calendar/view-model'
import type { CalendarSlot } from '@/lib/calendar/types'

import { SlotBlock } from './SlotBlock'

// Wave A — pure layout. 7 day columns + time-axis column. Each day
// column is a positioned container; slot blocks float over it via
// absolute positioning derived from `view-model.groupSlotsByDay`.
// Hours 06:00 → 23:30 in 30-min rows = 35 rows × CALENDAR_GRID_PX_PER_MIN.
//
// Keyboard / focus contract (Codex round 1 #28 — defined in skeleton,
// not deferred to polish):
//   - The grid is `role="grid"` with arrow-key focus across cells
//     (PR3 will wire this when interactions land; PR2 just renders)
//   - Each `<SlotBlock>` is a focusable button with aria-label

export type GridProps = {
  fromYmd: string
  slots: ReadonlyArray<CalendarSlot>
  onSlotClick?: (row: CalendarRow) => void
}

const DOW_RU = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

export function Grid({ fromYmd, slots, onSlotClick }: GridProps) {
  const days = weekDayKeys(fromYmd)
  const labels = timeAxisLabels()
  const grouped = groupSlotsByDay(slots)
  const dayHeight = CALENDAR_GRID_DAY_HEIGHT_PX

  return (
    <div
      role="grid"
      aria-label="Календарь слотов на неделю"
      style={{
        display: 'grid',
        gridTemplateColumns: '60px repeat(7, 1fr)',
        gap: 0,
        border: '1px solid rgba(255,255,255,0.07)',
        borderRadius: 12,
        overflow: 'hidden',
        background: 'rgba(255,255,255,0.02)',
      }}
    >
      {/* Header row: empty corner + 7 day labels */}
      <div style={{ background: 'rgba(255,255,255,0.04)' }} />
      {days.map((ymd, i) => (
        <div
          key={ymd}
          style={{
            background: 'rgba(255,255,255,0.04)',
            padding: '12px 8px',
            borderLeft: '1px solid rgba(255,255,255,0.06)',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: 11, color: '#9ca3af', textTransform: 'uppercase' }}>
            {DOW_RU[i]}
          </div>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#e4e4e7' }}>
            {ymd.slice(8, 10)}.{ymd.slice(5, 7)}
          </div>
        </div>
      ))}

      {/* Time axis column */}
      <div
        style={{
          position: 'relative',
          height: `${dayHeight}px`,
          borderTop: '1px solid rgba(255,255,255,0.06)',
        }}
        aria-hidden="true"
      >
        {labels.map((label, i) => (
          <div
            key={label}
            style={{
              position: 'absolute',
              top: `${i * 30 * CALENDAR_GRID_PX_PER_MIN}px`,
              left: 0,
              right: 0,
              fontSize: 10,
              color: '#71717a',
              textAlign: 'right',
              padding: '0 6px',
              transform: 'translateY(-50%)',
            }}
          >
            {label}
          </div>
        ))}
      </div>

      {/* Day columns */}
      {days.map((ymd) => (
        <div
          key={ymd}
          role="gridcell"
          aria-label={`День ${ymd}`}
          style={{
            position: 'relative',
            height: `${dayHeight}px`,
            borderLeft: '1px solid rgba(255,255,255,0.06)',
            borderTop: '1px solid rgba(255,255,255,0.06)',
            backgroundImage: gridBackground(),
            backgroundSize: `100% ${30 * CALENDAR_GRID_PX_PER_MIN}px`,
          }}
        >
          {(grouped.get(ymd) || []).map((row, i) => (
            <SlotBlock
              key={row.slot.kind === 'booked-other' ? `bo-${i}-${row.topPx}` : row.slot.id ?? `r-${i}`}
              row={row}
              onClick={onSlotClick}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

function gridBackground(): string {
  // Faint horizontal lines every 30 min. Implemented as repeating
  // linear-gradient so we don't have to render 35 separator divs per day.
  return `repeating-linear-gradient(to bottom, transparent 0, transparent ${
    30 * CALENDAR_GRID_PX_PER_MIN - 1
  }px, rgba(255,255,255,0.04) ${30 * CALENDAR_GRID_PX_PER_MIN - 1}px, rgba(255,255,255,0.04) ${
    30 * CALENDAR_GRID_PX_PER_MIN
  }px)`
}
