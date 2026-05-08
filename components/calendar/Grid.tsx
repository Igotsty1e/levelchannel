'use client'

import { useCallback, useRef } from 'react'

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
// PR3b: drag-paint + drag-move wiring. Each day column owns mouse
// events; coords are translated to (ymd, halfHour) via the column's
// bounding rect and the half-hour pixel constant. The reducer in
// the parent decides what to do with them.

export type GridDragHandlers = {
  // Fired when an empty cell is mouse-downed (paint start).
  onCellMouseDown?: (ymd: string, halfHour: number) => void
  // Fired when the mouse drifts during a drag. Parent decides
  // whether to extend a paint or move based on its state.
  onCellMouseEnter?: (ymd: string, halfHour: number) => void
  // Fired when an existing slot is mouse-downed (move start).
  onSlotMouseDown?: (row: CalendarRow, halfHour: number) => void
  // Visual highlight during paint — parent passes the current span.
  paintHighlight?: {
    readonly ymd: string
    readonly fromHalfHour: number
    readonly toHalfHour: number
  } | null
  // Visual ghost during move — parent passes predicted new position.
  moveGhost?: {
    readonly ymd: string
    readonly halfHour: number
    readonly durationMinutes: number
  } | null
}

export type GridProps = {
  fromYmd: string
  slots: ReadonlyArray<CalendarSlot>
  onSlotClick?: (row: CalendarRow) => void
  drag?: GridDragHandlers
}

const DOW_RU = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

const CELL_HEIGHT_PX = 30 * CALENDAR_GRID_PX_PER_MIN

export function Grid({ fromYmd, slots, onSlotClick, drag }: GridProps) {
  const days = weekDayKeys(fromYmd)
  const labels = timeAxisLabels()
  const grouped = groupSlotsByDay(slots)
  const dayHeight = CALENDAR_GRID_DAY_HEIGHT_PX

  // Refs to each day column for hit-test coord math during drag.
  // Uses a Map keyed by ymd so paint/move handlers can find the
  // column's bounding rect from any pointer event without prop drilling.
  const dayRefs = useRef<Map<string, HTMLDivElement | null>>(new Map())
  const setDayRef = useCallback(
    (ymd: string) => (el: HTMLDivElement | null) => {
      dayRefs.current.set(ymd, el)
    },
    [],
  )

  function halfHourFromOffset(offsetY: number): number {
    const cell = Math.floor(offsetY / CELL_HEIGHT_PX)
    if (cell < 0) return 0
    if (cell > 35) return 35
    return cell
  }

  function handleColumnMouseDown(
    e: React.MouseEvent<HTMLDivElement>,
    ymd: string,
  ) {
    if (!drag?.onCellMouseDown) return
    // SlotBlock stops propagation on its own mousedown — so reaching
    // here means the user pressed on an empty cell, not a slot block.
    const rect = e.currentTarget.getBoundingClientRect()
    const halfHour = halfHourFromOffset(e.clientY - rect.top)
    drag.onCellMouseDown(ymd, halfHour)
  }

  function handleColumnMouseMove(
    e: React.MouseEvent<HTMLDivElement>,
    ymd: string,
  ) {
    if (!drag?.onCellMouseEnter) return
    const rect = e.currentTarget.getBoundingClientRect()
    const halfHour = halfHourFromOffset(e.clientY - rect.top)
    drag.onCellMouseEnter(ymd, halfHour)
  }

  function handleSlotMouseDown(
    row: CalendarRow,
    e: React.MouseEvent<HTMLButtonElement>,
  ) {
    if (!drag?.onSlotMouseDown) return
    // Stop propagation so the column's onMouseDown (which would
    // start paint) doesn't fire.
    e.stopPropagation()
    // Origin halfHour = the slot's start cell. Compute from
    // CalendarRow.topPx (already pixel-accurate from view-model).
    const halfHour = Math.round(row.topPx / CELL_HEIGHT_PX)
    drag.onSlotMouseDown(row, halfHour)
  }

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
        userSelect: 'none', // drag without text selection nuisance
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
          ref={setDayRef(ymd)}
          role="gridcell"
          aria-label={`День ${ymd}`}
          onMouseDown={(e) => handleColumnMouseDown(e, ymd)}
          onMouseMove={(e) => handleColumnMouseMove(e, ymd)}
          style={{
            position: 'relative',
            height: `${dayHeight}px`,
            borderLeft: '1px solid rgba(255,255,255,0.06)',
            borderTop: '1px solid rgba(255,255,255,0.06)',
            backgroundImage: gridBackground(),
            backgroundSize: `100% ${30 * CALENDAR_GRID_PX_PER_MIN}px`,
            cursor: drag?.onCellMouseDown ? 'crosshair' : 'default',
          }}
        >
          {(grouped.get(ymd) || []).map((row, i) => (
            <SlotBlock
              key={row.slot.kind === 'booked-other' ? `bo-${i}-${row.topPx}` : row.slot.id ?? `r-${i}`}
              row={row}
              onClick={onSlotClick}
              onMouseDown={
                drag?.onSlotMouseDown
                  ? (r, e) => handleSlotMouseDown(r, e)
                  : undefined
              }
            />
          ))}
          {/* Paint highlight overlay — only on the column being painted */}
          {drag?.paintHighlight && drag.paintHighlight.ymd === ymd ? (
            <PaintHighlight
              fromHalfHour={drag.paintHighlight.fromHalfHour}
              toHalfHour={drag.paintHighlight.toHalfHour}
            />
          ) : null}
          {/* Move ghost overlay — only on the column where the cursor is */}
          {drag?.moveGhost && drag.moveGhost.ymd === ymd ? (
            <MoveGhost
              halfHour={drag.moveGhost.halfHour}
              durationMinutes={drag.moveGhost.durationMinutes}
            />
          ) : null}
        </div>
      ))}
    </div>
  )
}

function PaintHighlight({
  fromHalfHour,
  toHalfHour,
}: {
  fromHalfHour: number
  toHalfHour: number
}) {
  const lo = Math.min(fromHalfHour, toHalfHour)
  const hi = Math.max(fromHalfHour, toHalfHour)
  const top = lo * CELL_HEIGHT_PX
  const height = (hi - lo + 1) * CELL_HEIGHT_PX
  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute',
        left: 4,
        right: 4,
        top: `${top}px`,
        height: `${height}px`,
        background: 'rgba(34, 197, 94, 0.18)',
        border: '2px dashed rgba(34, 197, 94, 0.7)',
        borderRadius: 6,
        pointerEvents: 'none',
        zIndex: 5,
      }}
    />
  )
}

function MoveGhost({
  halfHour,
  durationMinutes,
}: {
  halfHour: number
  durationMinutes: number
}) {
  const top = halfHour * CELL_HEIGHT_PX
  const height = durationMinutes * CALENDAR_GRID_PX_PER_MIN
  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute',
        left: 4,
        right: 4,
        top: `${top}px`,
        height: `${height}px`,
        background: 'rgba(59, 130, 246, 0.20)',
        border: '2px dashed rgba(59, 130, 246, 0.7)',
        borderRadius: 6,
        pointerEvents: 'none',
        zIndex: 5,
      }}
    />
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
