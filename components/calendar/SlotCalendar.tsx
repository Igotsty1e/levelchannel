'use client'

import { useCallback, useEffect, useReducer, useRef, useState } from 'react'

import { findCellAt as pureFindCellAt } from '@/lib/calendar/grid-hit-test'
import {
  type DragState,
  initialDragState,
  reduceDrag,
  type PaintSpan,
  type MoveTarget,
} from '@/lib/calendar/drag-state'
import type { CalendarResponse } from '@/lib/calendar/types'
import type { CalendarRow } from '@/lib/calendar/view-model'

import { Grid } from './Grid'
import { MobileFallback, useNarrowContainer } from './MobileFallback'
import { Toolbar } from './Toolbar'

// Wave A composition root.
//
// PR3b — drag interactions opt-in via `interactions`. Teacher surface
// (read-only) doesn't pass it. Operator surface passes onPaintSpan +
// onMoveTarget; SlotCalendar owns the drag-state reducer and emits
// raw spans/targets to the parent on commit. Parent owns confirm
// modal, POST, toast, and refetch (via key bump).
//
// Codex 2026-05-08 (post-implementation review) prescribed 4 fixes:
//   HIGH 1 — listener attach race: useEffect-based attachment can
//     miss a fast mouseup. Solution: listeners always-on (mounted
//     once), early-return on idle. Cost is one if-check per mouse
//     event globally; cheap.
//   HIGH 2 — non-open slot clickability: dragHandlers must NOT
//     suppress onSlotClick globally. Solution: always pass
//     onSlotClick to Grid; suppress click-after-drag-commit via a
//     ref consulted by SlotBlock's onClick.
//   MEDIUM 1 — window-blur / visibilitychange cancel for stuck
//     drag state.
//   MEDIUM 2 — backdrop-click during in-flight POST (handled at the
//     PaintConfirmModal layer).

// 2026-06-14 teacher-calendar-mouse-fix — pixel-distance threshold
// separating a pure click on an empty cell from a drag-paint. Before
// this, every `mousedown` on a cell put the reducer into `painting`
// state and every `mouseup` (even with no movement) committed a 1-cell
// paint span, opening PaintConfirmModal with a broken «range shorter
// than chosen duration» banner. Convention across FullCalendar / Cal.com
// / Cocoa / Windows DnD is 4-10px. Grid half-hour rows are ~24px tall,
// so 5px = ~20% of a cell — above pointer jitter, below «drift into
// next cell». Slot move does NOT use this gate (its own drift detection
// at cell-granularity already protects against same-cell mouseups).
export const MOUSE_DRAG_THRESHOLD_PX = 5

export type CalendarInteractions = {
  onPaintSpan?: (span: PaintSpan) => void
  onMoveTarget?: (target: MoveTarget) => void
}

export type SlotCalendarProps = {
  teacherId: string
  initialFromYmd: string
  // Click handler fires when user taps a slot WITHOUT dragging.
  // Drag-move drift past origin cell suppresses the next click via
  // `suppressClickRef`, so a drag commit doesn't double-fire as
  // both move + click.
  onSlotClick?: (row: CalendarRow) => void
  interactions?: CalendarInteractions
  // Codex 2026-05-08 Wave C review: parent triggers an in-place
  // refetch by incrementing this number. Avoids the key-bump
  // pattern that remounted the whole component and reset fromYmd
  // back to the initial week — broke the workflow when an operator
  // / teacher was working two weeks ahead and any mutation jumped
  // them back to the current week.
  refreshTrigger?: number
  // 2026-06-14 teacher-calendar-mouse-fix (Sub-PR 2) — parent bumps
  // this on every modal-open transition so we can defensively clear
  // a stale `painting` reducer state + `pendingPaintRef` +
  // `suppressClickRef`. Race scenario: drag starts, async modal
  // opens before mouseup → reducer stuck in `painting` → next mouseup
  // would commit a stray paint span after modal close. The signal
  // makes the invariant explicit instead of relying on z-index
  // discipline.
  dragResetSignal?: number
}

export function SlotCalendar({
  teacherId,
  initialFromYmd,
  onSlotClick,
  interactions,
  refreshTrigger,
  dragResetSignal,
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
  }, [teacherId, fromYmd, reloadCounter, refreshTrigger])

  // ---- drag wiring ----

  type Action = Parameters<typeof reduceDrag>[1]
  function dragReducer(s: DragState, a: Action): DragState {
    return reduceDrag(s, a).state
  }
  const [dragState, dispatchRaw] = useReducer(
    dragReducer,
    initialDragState as DragState,
  )

  // Mirror dragState into a ref so always-on document handlers can
  // read live state. React's setState batching means dispatchRaw's
  // result isn't visible until next commit, but reduceDrag is pure
  // so the ref tracks the post-action state immediately.
  const dragStateRef = useRef<DragState>(initialDragState)
  useEffect(() => {
    dragStateRef.current = dragState
  }, [dragState])

  // Day-column refs for hit-testing during drag. SlotBlock has higher
  // zIndex so the day column's onMouseMove doesn't fire while the
  // cursor is over a slot block — we use document-level events and
  // find the right column via getBoundingClientRect.
  const dayRefs = useRef<Map<string, HTMLElement>>(new Map())
  const setDayEl = useCallback((ymd: string, el: HTMLElement | null) => {
    if (el === null) dayRefs.current.delete(ymd)
    else dayRefs.current.set(ymd, el)
  }, [])

  function findCellAt(
    clientX: number,
    clientY: number,
  ): { ymd: string; halfHour: number } | null {
    // SAAS-1 5.F (2026-05-18) — delegate to the pure helper so the
    // geometry logic is node-testable. We still iterate dayRefs here
    // because each rect is live (DOM mutates on scroll/resize).
    for (const [ymd, el] of dayRefs.current) {
      const rect = el.getBoundingClientRect()
      const hit = pureFindCellAt(clientX, clientY, [
        {
          ymd,
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
        },
      ])
      if (hit) return hit
    }
    return null
  }

  // suppressClickRef: set to true on the FIRST cellMouseEnter that
  // shows drift (origin != current). SlotBlock's onClick reads + clears
  // this ref before calling onSlotClick. Drift-less mouseup → ref
  // stays false → click fires normally → modal opens.
  const suppressClickRef = useRef(false)

  // 2026-06-14 teacher-calendar-mouse-fix — captures the anchor for a
  // potential paint while we wait to see if it's a click or a drag.
  // Only the wiring layer knows DOM pixel coords; the reducer stays
  // pure in calendar-cell units. When the document-level `mousemove`
  // sees |dx|+|dy| above threshold (Chebyshev), we promote this to a
  // real `cellMouseDown` dispatch + clear the ref. `mouseup` with the
  // ref still set means the user clicked without dragging → no commit,
  // no modal.
  const pendingPaintRef = useRef<{
    clientX: number
    clientY: number
    ymd: string
    halfHour: number
  } | null>(null)

  // Wraps the reducer + fires effects via interactions callbacks.
  const dispatch = useCallback(
    (action: Action): DragState => {
      const out = reduceDrag(dragStateRef.current, action)
      dragStateRef.current = out.state
      dispatchRaw(action)
      if (out.effect) {
        if (out.effect.kind === 'paintCommit') {
          interactions?.onPaintSpan?.(out.effect.span)
        } else if (out.effect.kind === 'moveCommit') {
          interactions?.onMoveTarget?.(out.effect.target)
        }
      }
      return out.state
    },
    [interactions],
  )

  // Always-on document handlers (Codex HIGH 1 fix). Attach ONCE on
  // mount; early-return when idle. Avoids the useEffect-attach race
  // where a fast mousedown→mouseup can fire before the listener is
  // bound to document.
  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      // 2026-06-14 click-vs-drag threshold gate. We deferred the
      // `cellMouseDown` dispatch in dragHandlers; promote it now if
      // the cursor has moved enough to be a real drag.
      const pending = pendingPaintRef.current
      if (pending) {
        const dx = Math.abs(e.clientX - pending.clientX)
        const dy = Math.abs(e.clientY - pending.clientY)
        if (Math.max(dx, dy) >= MOUSE_DRAG_THRESHOLD_PX) {
          pendingPaintRef.current = null
          dispatch({
            type: 'cellMouseDown',
            coords: { ymd: pending.ymd, halfHour: pending.halfHour },
          })
          // fall through to the hit-test + cellMouseEnter dispatch
          // below so the anchor cell is also visited (and any drift
          // into a neighbouring cell extends the span on this same
          // mousemove tick).
        } else {
          return
        }
      }
      if (dragStateRef.current.kind === 'idle') return
      const cell = findCellAt(e.clientX, e.clientY)
      if (!cell) return
      const live = dragStateRef.current
      if (
        live.kind === 'moving' &&
        (live.originYmd !== cell.ymd || live.originHalfHour !== cell.halfHour)
      ) {
        suppressClickRef.current = true
      }
      dispatch({
        type: 'cellMouseEnter',
        coords: { ymd: cell.ymd, halfHour: cell.halfHour },
      })
    }

    function onMouseUp() {
      // 2026-06-14 click-vs-drag threshold gate. If the ref is still
      // set on mouseup, the cursor never crossed the threshold —
      // treat it as a pure click on an empty cell. No `cellMouseDown`
      // ever dispatched, so the reducer is still idle. No paint span
      // commits. No modal opens. This is the BUG-1 fix.
      if (pendingPaintRef.current) {
        pendingPaintRef.current = null
        return
      }
      if (dragStateRef.current.kind === 'idle') return
      dispatch({ type: 'mouseUp' })
    }

    function onKeyDown(e: KeyboardEvent) {
      if (dragStateRef.current.kind === 'idle') return
      if (e.key === 'Escape') {
        dispatch({ type: 'escape' })
        suppressClickRef.current = false
      }
    }

    // Codex MEDIUM 1 fix: stuck drag if the user drags off-window
    // and releases there, OR switches tabs mid-drag. window blur and
    // document.visibilitychange catch both. pointercancel covers
    // touch/pen scenarios when the OS revokes the gesture.
    function onCancelGesture() {
      // 2026-06-14: also clear any deferred paint anchor on gesture
      // cancel — otherwise a tab-switch mid-mousedown would leak the
      // ref and the next mousemove could promote a stale anchor.
      pendingPaintRef.current = null
      if (dragStateRef.current.kind === 'idle') return
      dispatch({ type: 'reset' })
      suppressClickRef.current = false
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointercancel', onCancelGesture)
    document.addEventListener('visibilitychange', onCancelGesture)
    window.addEventListener('blur', onCancelGesture)
    return () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointercancel', onCancelGesture)
      document.removeEventListener('visibilitychange', onCancelGesture)
      window.removeEventListener('blur', onCancelGesture)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handlePrev = () => setFromYmd(addDaysYmd(fromYmd, -7))
  const handleNext = () => setFromYmd(addDaysYmd(fromYmd, 7))
  const handleToday = () => setFromYmd(initialFromYmd)
  const handleRefresh = () => setReloadCounter((n) => n + 1)

  // 2026-06-14 defensive — clear any pending drag/paint anchor when
  // the parent signals a modal opened. Skip on first mount (signal=0
  // ≡ initial value, no transition).
  useEffect(() => {
    if (dragResetSignal === undefined || dragResetSignal === 0) return
    pendingPaintRef.current = null
    suppressClickRef.current = false
    if (dragStateRef.current.kind !== 'idle') {
      dispatch({ type: 'reset' })
    }
  }, [dragResetSignal, dispatch])

  // SlotBlock click-suppression wrapper (Codex HIGH 2 fix).
  // Replaces the previous "drop onSlotClick when dragHandlers active"
  // hack which broke clicks on non-open kinds.
  const wrappedSlotClick = useCallback(
    (row: CalendarRow) => {
      if (suppressClickRef.current) {
        suppressClickRef.current = false
        return
      }
      onSlotClick?.(row)
    },
    [onSlotClick],
  )

  // ---- drag handlers passed to Grid ----

  const dragHandlers = interactions
    ? {
        onCellMouseDown: interactions.onPaintSpan
          ? (
              ymd: string,
              halfHour: number,
              clientX: number,
              clientY: number,
            ) => {
              // 2026-06-14 click-vs-drag threshold. We DON'T dispatch
              // `cellMouseDown` yet — defer until the document-level
              // mousemove confirms the cursor moved at least
              // MOUSE_DRAG_THRESHOLD_PX away from the anchor. mouseup
              // without movement = pure click, no commit, no modal.
              suppressClickRef.current = false
              pendingPaintRef.current = { clientX, clientY, ymd, halfHour }
            }
          : undefined,
        onSlotMouseDown: interactions.onMoveTarget
          ? (row: CalendarRow, halfHour: number) => {
              if (row.slot.kind !== 'open' || !row.slot.id) return
              // suppressClickRef stays false here; cellMouseEnter
              // sets it on first drift detection.
              dispatch({
                type: 'slotMouseDown',
                slotId: row.slot.id,
                durationMinutes: row.slot.durationMinutes,
                coords: { ymd: row.dayYmd, halfHour },
              })
            }
          : undefined,
        onCellMouseEnter:
          interactions.onPaintSpan || interactions.onMoveTarget
            ? (ymd: string, halfHour: number) =>
                dispatch({
                  type: 'cellMouseEnter',
                  coords: { ymd, halfHour },
                })
            : undefined,
        // SAAS-1-FOLLOWUP-KEYBOARD wave-paranoia round-1 BLOCKER#1
        // closure (2026-05-19): keyboard-driven single-cell commit.
        // Atomically dispatches cellMouseDown + mouseUp on a fresh
        // tick of the reducer so `interactions.onPaintSpan` fires
        // and opens PaintConfirmModal. Without this the calendar
        // got stuck in `painting` state with no commit path.
        onCellKeyboardCommit: interactions.onPaintSpan
          ? (ymd: string, halfHour: number) => {
              suppressClickRef.current = false
              dispatch({
                type: 'cellMouseDown',
                coords: { ymd, halfHour },
              })
              dispatch({ type: 'mouseUp' })
            }
          : undefined,
        paintHighlight:
          dragState.kind === 'painting'
            ? {
                ymd: dragState.ymd,
                fromHalfHour: dragState.fromHalfHour,
                toHalfHour: dragState.toHalfHour,
              }
            : null,
        moveGhost:
          dragState.kind === 'moving' &&
          (dragState.currentYmd !== dragState.originYmd ||
            dragState.currentHalfHour !== dragState.originHalfHour)
            ? {
                ymd: dragState.currentYmd,
                halfHour: dragState.currentHalfHour,
                durationMinutes: dragState.durationMinutes,
              }
            : null,
      }
    : undefined

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
          <GridWithRefs
            fromYmd={fromYmd}
            slots={response.slots}
            onSlotClick={dragHandlers ? wrappedSlotClick : onSlotClick}
            drag={dragHandlers}
            setDayEl={setDayEl}
          />
        )
      ) : null}
    </div>
  )
}

// Wrapper that propagates day-column refs from Grid up to SlotCalendar.
// Keeps Grid pure (no ref-API churn) while letting SlotCalendar do
// document-level hit-testing during drag. Day cells are identified by
// `aria-label="День YYYY-MM-DD"` (already used by Grid for screen
// readers), so the wrapper extracts them by querySelector.
function GridWithRefs(
  props: React.ComponentProps<typeof Grid> & {
    setDayEl: (ymd: string, el: HTMLElement | null) => void
  },
) {
  const { setDayEl, ...gridProps } = props
  const wrapperRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const root = wrapperRef.current
    if (!root) return
    // SAAS-1-FOLLOWUP-KEYBOARD wave-paranoia round-1 BLOCKER#2 closure
    // (2026-05-19): selector widened to match either `role="gridcell"`
    // (legacy) OR `role="row"` (new ARIA-correct day-column role from
    // PR #354). Without this widening, mouse drag hit-test silently
    // breaks because root.querySelectorAll returns 0 cells under the
    // post-#354 markup.
    const cells = root.querySelectorAll<HTMLElement>(
      '[aria-label^="День "]',
    )
    const ymds: string[] = []
    cells.forEach((el) => {
      const ariaLabel = el.getAttribute('aria-label') || ''
      const ymd = ariaLabel.replace(/^День\s+/, '')
      if (ymd) {
        setDayEl(ymd, el)
        ymds.push(ymd)
      }
    })
    return () => {
      ymds.forEach((ymd) => setDayEl(ymd, null))
    }
  })
  return (
    <div ref={wrapperRef}>
      <Grid {...gridProps} />
    </div>
  )
}

function addDaysYmd(ymd: string, days: number): string {
  const [y, mo, d] = ymd.split('-').map(Number)
  const date = new Date(Date.UTC(y, mo - 1, d + days))
  return date.toISOString().slice(0, 10)
}
