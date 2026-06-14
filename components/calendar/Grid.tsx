'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import {
  CALENDAR_GRID_DAY_HEIGHT_PX,
  CALENDAR_GRID_PX_PER_MIN,
} from '@/lib/calendar/dates'
import {
  halfHourFromOffset as halfHourFromOffsetPure,
} from '@/lib/calendar/grid-hit-test'
import {
  type ActiveCell,
  HALF_HOUR_COUNT,
  navKeyFromEvent,
  nextActiveCell,
  slotAtCell,
} from '@/lib/calendar/grid-keyboard'
import {
  type CalendarRow,
  currentTimeTopPx,
  groupSlotsByDay,
  hourAxisLabels,
  mskYmdNow,
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
  // clientX/clientY are forwarded so the wiring layer can implement
  // a pixel-distance click-vs-drag threshold without re-deriving DOM
  // coords. See SlotCalendar.tsx MOUSE_DRAG_THRESHOLD_PX.
  onCellMouseDown?: (
    ymd: string,
    halfHour: number,
    clientX: number,
    clientY: number,
  ) => void
  // Fired when the mouse drifts during a drag. Parent decides
  // whether to extend a paint or move based on its state.
  onCellMouseEnter?: (ymd: string, halfHour: number) => void
  // Fired when an existing slot is mouse-downed (move start).
  onSlotMouseDown?: (row: CalendarRow, halfHour: number) => void
  // SAAS-1-FOLLOWUP-KEYBOARD wave-paranoia round-1 BLOCKER#1 closure
  // (2026-05-19): keyboard Enter/Space on an empty cell needs to BOTH
  // start the paint AND commit it (open the PaintConfirmModal). With
  // a mouse this happens via document-level mouseup; for keyboard
  // there is no mouseup, so the parent gets a dedicated handler that
  // atomically dispatches mouseDown + mouseUp via the reducer.
  // Single-cell span (halfHour, halfHour+1).
  onCellKeyboardCommit?: (ymd: string, halfHour: number) => void
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
  // SAAS-1: Apple-style time axis shows hour labels only; half-hour
  // marks are dotted sub-ticks in the grid background.
  const labels = hourAxisLabels()
  const grouped = groupSlotsByDay(slots)
  const dayHeight = CALENDAR_GRID_DAY_HEIGHT_PX

  // SAAS-1: today highlight + current-time indicator (live tick every
  // 60 s). nowMs is null on first SSR render to avoid hydration
  // mismatch; populated by useEffect on mount.
  const [nowMs, setNowMs] = useState<number | null>(null)
  useEffect(() => {
    setNowMs(Date.now())
    const tick = setInterval(() => setNowMs(Date.now()), 60_000)
    return () => clearInterval(tick)
  }, [])
  const todayYmd = nowMs !== null ? mskYmdNow(nowMs) : null
  const currentTimeTop = nowMs !== null ? currentTimeTopPx(nowMs) : null

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

  // SAAS-1-FOLLOWUP-KEYBOARD — roving-tabindex focus model.
  // `focusedCell` is the single (dayIdx, halfHour) that owns `tabIndex={0}`
  // among all overlay cells + SlotBlocks. Default = (0, 6) ≈ 09:00 (first
  // half-hour after 06:00 + 6 × 30min). If today is in the visible week,
  // we prefer (todayIdx, 6) on mount. See docs/plans/saas-1-followup-
  // keyboard.md §2.1.
  const [focusedCell, setFocusedCell] = useState<ActiveCell>({
    dayIdx: 0,
    halfHour: 6,
  })
  // After we mount and discover today, jump focus to today's column.
  // Guarded so it only runs once per mount; user-driven nav after that
  // is unaffected.
  const initialFocusAppliedRef = useRef(false)
  useEffect(() => {
    if (initialFocusAppliedRef.current) return
    if (todayYmd === null) return
    const idx = days.indexOf(todayYmd)
    if (idx >= 0) {
      setFocusedCell({ dayIdx: idx, halfHour: 6 })
    }
    initialFocusAppliedRef.current = true
  }, [todayYmd, days])

  // Cell ref map keyed by `${ymd}#${halfHour}` so the focus effect can
  // imperatively move DOM focus to whatever the current `focusedCell`
  // resolves to. SlotBlock refs are NOT stored here (they own their own
  // tabIndex via the existing <button>; see §4 of the plan-doc) — only
  // empty-overlay cells live in this map.
  const cellRefs = useRef<Map<string, HTMLDivElement | null>>(new Map())
  const setCellRef = useCallback(
    (key: string) => (el: HTMLDivElement | null) => {
      if (el === null) {
        cellRefs.current.delete(key)
      } else {
        cellRefs.current.set(key, el)
      }
    },
    [],
  )

  // After focus state changes, move DOM focus to the newly-active cell.
  // Skip on first render (don't steal focus from the page on mount —
  // the user must Tab in first). `hasFocusInsideGridRef` tracks whether
  // the grid currently contains document.activeElement; if not, we
  // skip the imperative .focus() call so we don't yank focus away from
  // some other surface the user is interacting with.
  const hasFocusInsideGridRef = useRef(false)
  useEffect(() => {
    if (!hasFocusInsideGridRef.current) return
    const ymd = days[focusedCell.dayIdx]
    if (!ymd) return
    const key = `${ymd}#${focusedCell.halfHour}`
    const node = cellRefs.current.get(key)
    if (node) {
      node.focus()
      if (typeof node.scrollIntoView === 'function') {
        node.scrollIntoView({ block: 'nearest', behavior: 'auto' })
      }
    }
  }, [focusedCell, days])

  function handleGridKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    // SAAS-1-FOLLOWUP-KEYBOARD wave-paranoia round-2 BLOCKER closure
    // (2026-05-19): when focus is on a SlotBlock <button> (already
    // tabbable with its own onClick), let the button's native
    // Enter/Space handler fire — don't preventDefault + don't
    // operate on stale `focusedCell` from the empty-cell roving
    // model. Without this gate, Tab to a slot then Enter would
    // either open the wrong slot or start a paint at the last
    // roving-cell position.
    //
    // SlotBlock is the only <button> descendant inside the grid
    // (day-cell overlays are <div role="gridcell">), so tag check
    // is sufficient.
    const target = e.target as HTMLElement | null
    if (
      target
      && target.tagName === 'BUTTON'
      && target !== e.currentTarget
    ) {
      return
    }
    const navKey = navKeyFromEvent(e.key)
    if (navKey !== null) {
      e.preventDefault()
      setFocusedCell((cur) => nextActiveCell(cur, navKey))
      return
    }
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault()
      const ymd = days[focusedCell.dayIdx]
      if (!ymd) return
      const row = slotAtCell(grouped, ymd, focusedCell.halfHour, CELL_HEIGHT_PX)
      if (row && onSlotClick) {
        onSlotClick(row)
      } else if (!row) {
        // SAAS-1-FOLLOWUP-KEYBOARD wave-paranoia round-1 BLOCKER#1
        // closure (2026-05-19): prefer the atomic keyboard-commit
        // handler if the parent provides it; fall back to the old
        // mouseDown-only path for backward compatibility. The new
        // path opens PaintConfirmModal, the old path silently puts
        // the calendar in `painting` state and leaks if no mouseup
        // follows.
        if (drag?.onCellKeyboardCommit) {
          drag.onCellKeyboardCommit(ymd, focusedCell.halfHour)
        } else if (drag?.onCellMouseDown) {
          // Keyboard fallback path: no real mouse coords. Pass zeros;
          // wiring-layer threshold won't matter because no mouseup
          // follows for keyboard-only commit (keyboard goes through
          // onCellKeyboardCommit when available).
          drag.onCellMouseDown(ymd, focusedCell.halfHour, 0, 0)
        }
      }
    }
  }

  // SAAS-1 5.F (2026-05-18) — moved to lib/calendar/grid-hit-test.ts.
  // Local alias keeps the call-site below readable + matches the
  // SlotBlock-aligned slot-top math that uses CELL_HEIGHT_PX.
  const halfHourFromOffset = halfHourFromOffsetPure

  function handleColumnMouseDown(
    e: React.MouseEvent<HTMLDivElement>,
    ymd: string,
  ) {
    if (!drag?.onCellMouseDown) return
    // SlotBlock stops propagation on its own mousedown — so reaching
    // here means the user pressed on an empty cell, not a slot block.
    const rect = e.currentTarget.getBoundingClientRect()
    const halfHour = halfHourFromOffset(e.clientY - rect.top)
    drag.onCellMouseDown(ymd, halfHour, e.clientX, e.clientY)
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
      aria-label="Календарь занятий на неделю"
      onKeyDown={handleGridKeyDown}
      onFocus={() => {
        hasFocusInsideGridRef.current = true
      }}
      onBlur={(e) => {
        // currentTarget is the grid container; relatedTarget is what's
        // about to receive focus. If it's still inside the grid, keep
        // the flag set (cell-to-cell nav). If it's outside (Tab away),
        // clear it so the next state change doesn't yank focus back.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          hasFocusInsideGridRef.current = false
        }
      }}
      style={{
        display: 'grid',
        gridTemplateColumns: '60px repeat(7, 1fr)',
        gap: 0,
        border: '1px solid var(--border)',
        borderRadius: 12,
        overflow: 'hidden',
        background: 'var(--surface-1, transparent)',
        userSelect: 'none',
      }}
    >
      {/* Header row: empty corner + 7 day labels */}
      <div style={{ background: 'var(--surface-2, rgba(255,255,255,0.04))' }} />
      {days.map((ymd, i) => {
        const isToday = todayYmd === ymd
        return (
          <div
            key={ymd}
            style={{
              background: isToday
                ? 'color-mix(in srgb, var(--accent, #D88A82) 8%, var(--surface-2, rgba(255,255,255,0.04)))'
                : 'var(--surface-2, rgba(255,255,255,0.04))',
              padding: '12px 8px',
              borderLeft: '1px solid var(--border)',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: 11, color: 'var(--secondary)', textTransform: 'uppercase' }}>
              {DOW_RU[i]}
            </div>
            <div
              style={{
                fontSize: 14,
                fontWeight: 600,
                color: isToday ? 'var(--accent, #D88A82)' : 'var(--text)',
              }}
            >
              {ymd.slice(8, 10)}.{ymd.slice(5, 7)}
            </div>
          </div>
        )
      })}

      {/* Time axis column — Apple-style hour-only labels */}
      <div
        style={{
          position: 'relative',
          height: `${dayHeight}px`,
          borderTop: '1px solid var(--border)',
        }}
        aria-hidden="true"
      >
        {labels.map((label, i) => (
          <div
            key={label}
            style={{
              position: 'absolute',
              top: `${i * 60 * CALENDAR_GRID_PX_PER_MIN}px`,
              left: 0,
              right: 0,
              fontSize: 10,
              color: 'var(--secondary)',
              textAlign: 'right',
              padding: '0 6px',
              transform: 'translateY(-50%)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {label}
          </div>
        ))}
      </div>

      {/* Day columns */}
      {days.map((ymd, dayIdx) => {
        const isToday = todayYmd === ymd
        return (
        <div
          key={ymd}
          ref={setDayRef(ymd)}
          role="row"
          aria-label={`День ${ymd}`}
          data-today={isToday ? 'true' : undefined}
          data-dayidx={dayIdx}
          onMouseDown={(e) => handleColumnMouseDown(e, ymd)}
          onMouseMove={(e) => handleColumnMouseMove(e, ymd)}
          style={{
            position: 'relative',
            height: `${dayHeight}px`,
            borderLeft: '1px solid var(--border)',
            borderTop: '1px solid var(--border)',
            backgroundImage: gridBackground(),
            backgroundSize: `100% ${60 * CALENDAR_GRID_PX_PER_MIN}px`,
            backgroundColor: isToday
              ? 'color-mix(in srgb, var(--accent, #D88A82) 4%, transparent)'
              : 'transparent',
            cursor: drag?.onCellMouseDown ? 'crosshair' : 'default',
          }}
        >
          {/* SAAS-1: dotted half-hour sub-tick overlay (1 per hour) */}
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              inset: 0,
              backgroundImage:
                `repeating-linear-gradient(to bottom, transparent 0, transparent ${
                  30 * CALENDAR_GRID_PX_PER_MIN - 1
                }px, rgba(255,255,255,0.035) ${
                  30 * CALENDAR_GRID_PX_PER_MIN - 1
                }px, rgba(255,255,255,0.035) ${30 * CALENDAR_GRID_PX_PER_MIN}px)`,
              backgroundSize: `100% ${60 * CALENDAR_GRID_PX_PER_MIN}px`,
              pointerEvents: 'none',
            }}
          />
          {/* SAAS-1: current-time indicator (only on today column) */}
          {isToday && currentTimeTop !== null ? (
            <div
              aria-hidden="true"
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                top: `${currentTimeTop}px`,
                height: 0,
                borderTop: '1.5px solid var(--accent, #e85a4f)',
                zIndex: 7,
                pointerEvents: 'none',
              }}
            >
              <span
                style={{
                  position: 'absolute',
                  left: -4,
                  top: -4,
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: 'var(--accent, #e85a4f)',
                }}
              />
            </div>
          ) : null}
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
          {/* SAAS-1-FOLLOWUP-KEYBOARD — invisible half-hour cells for
              roving-tabindex focus + keyboard activation. pointerEvents:
              'none' so the parent column's mouse handlers still get
              every click/drag; the cells are pure focus targets. The
              active cell carries tabIndex={0}; all others tabIndex={-1}. */}
          {Array.from({ length: HALF_HOUR_COUNT }, (_, halfHour) => {
            const isActive =
              focusedCell.dayIdx === dayIdx &&
              focusedCell.halfHour === halfHour
            const row = slotAtCell(grouped, ymd, halfHour, CELL_HEIGHT_PX)
            const cellKey = `${ymd}#${halfHour}`
            const hh = Math.floor(halfHour / 2) + 6
            const mm = halfHour % 2 === 0 ? '00' : '30'
            const status = row ? 'занят' : 'свободно'
            return (
              <div
                key={cellKey}
                ref={setCellRef(cellKey)}
                role="gridcell"
                tabIndex={isActive ? 0 : -1}
                aria-label={`${ymd} ${String(hh).padStart(2, '0')}:${mm} ${status}`}
                className="calendar-cell"
                data-dayidx={dayIdx}
                data-halfhour={halfHour}
                data-ymd={ymd}
                data-occupied={row ? 'true' : 'false'}
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  top: `${halfHour * CELL_HEIGHT_PX}px`,
                  height: `${CELL_HEIGHT_PX}px`,
                  pointerEvents: 'none',
                  zIndex: 6,
                }}
              />
            )
          })}
        </div>
        )
      })}
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
  // SAAS-1: hour-only grid divider (Apple-style). Half-hour sub-tick
  // is rendered as a separate dotted overlay inside each day column
  // (see the inline aria-hidden div in the column render).
  return `repeating-linear-gradient(to bottom, transparent 0, transparent ${
    60 * CALENDAR_GRID_PX_PER_MIN - 1
  }px, rgba(255,255,255,0.06) ${60 * CALENDAR_GRID_PX_PER_MIN - 1}px, rgba(255,255,255,0.06) ${
    60 * CALENDAR_GRID_PX_PER_MIN
  }px)`
}
