// Wave A PR3b — pure drag-state reducer for the operator calendar.
//
// Coords are calendar-native (`ymd` + `halfHour` index 0..35 covering
// 06:00..23:30 MSK), NOT DOM pixels. The wiring layer (SlotCalendar)
// translates mouse events into these coords by hit-testing the Grid
// before dispatching. This keeps the reducer testable without a DOM
// and pins the invariant that paint/move operate on calendar cells,
// not on pixel offsets that drift across zoom levels.
//
// Codex 2026-05-08 review for this design (terse): "[reducer] should
// work in calendar coordinates, not DOM/pixels. Tests on invariants:
// single-day only, move only `open`, derived starts always on 30m
// grid, error/409 => idle + refetch." This module pins (1)–(3); the
// SlotCalendar wiring + slots-view-switcher pin (4) by calling the
// `refetch` callback on any non-2xx response from paint/move endpoints.
//
// Why a reducer instead of inline `useState` plumbing: drag-paint and
// drag-move share the same lifecycle (start → drift → commit/cancel),
// and unifying them in one state machine lets us pin the "you cannot
// be both painting AND moving" invariant by construction. Testing the
// reducer head-on (no DOM, no React) catches every transition.

export type CalendarCoords = {
  readonly ymd: string
  readonly halfHour: number // 0..35; 0=06:00 MSK, 35=23:30 MSK
}

export type DragIdle = { readonly kind: 'idle' }

export type DragPainting = {
  readonly kind: 'painting'
  readonly ymd: string // single-day clamp — once paint starts on a ymd, it stays
  readonly fromHalfHour: number // anchor (mousedown cell)
  readonly toHalfHour: number // current cell during drag
}

export type DragMoving = {
  readonly kind: 'moving'
  readonly slotId: string
  readonly durationMinutes: number
  readonly originYmd: string
  readonly originHalfHour: number
  readonly currentYmd: string
  readonly currentHalfHour: number
}

export type DragState = DragIdle | DragPainting | DragMoving

export type DragAction =
  | {
      readonly type: 'cellMouseDown'
      readonly coords: CalendarCoords
    }
  | {
      readonly type: 'slotMouseDown'
      readonly slotId: string
      readonly durationMinutes: number
      readonly coords: CalendarCoords
    }
  | {
      readonly type: 'cellMouseEnter'
      readonly coords: CalendarCoords
    }
  | { readonly type: 'mouseUp' }
  | { readonly type: 'escape' }
  | { readonly type: 'reset' }

// On mouseUp the reducer signals what to commit (if anything) AND
// returns to idle. The caller (SlotCalendar) reads the effect, fires
// the network call, awaits, and asks the parent to refetch. The
// reducer itself is synchronous; the I/O layer is not its concern.

export type PaintSpan = {
  readonly ymd: string
  readonly fromHalfHour: number // inclusive
  readonly toHalfHour: number // inclusive
}

export type MoveTarget = {
  readonly slotId: string
  readonly durationMinutes: number
  readonly originYmd: string
  readonly originHalfHour: number
  readonly newYmd: string
  readonly newHalfHour: number
}

export type DragEffect =
  | { readonly kind: 'paintCommit'; readonly span: PaintSpan }
  | { readonly kind: 'moveCommit'; readonly target: MoveTarget }

export type DragReducerOutput = {
  readonly state: DragState
  readonly effect: DragEffect | null
}

export const initialDragState: DragIdle = { kind: 'idle' }

const HALF_HOUR_MIN = 0
const HALF_HOUR_MAX = 35 // 23:30 row inclusive

function clampHalfHour(h: number): number {
  if (h < HALF_HOUR_MIN) return HALF_HOUR_MIN
  if (h > HALF_HOUR_MAX) return HALF_HOUR_MAX
  return h
}

export function reduceDrag(
  state: DragState,
  action: DragAction,
): DragReducerOutput {
  switch (action.type) {
    case 'reset':
    case 'escape':
      return { state: { kind: 'idle' }, effect: null }

    case 'cellMouseDown': {
      // Starting paint on a cell. Always anchors at this coord.
      // Booted irrespective of the current state — escape would have
      // already fired if the user was mid-drag. Defensive idempotence.
      return {
        state: {
          kind: 'painting',
          ymd: action.coords.ymd,
          fromHalfHour: clampHalfHour(action.coords.halfHour),
          toHalfHour: clampHalfHour(action.coords.halfHour),
        },
        effect: null,
      }
    }

    case 'slotMouseDown': {
      // Starting move. Caller is responsible for ensuring this fires
      // ONLY on open slots (booked/completed/cancelled blocks return
      // early on mousedown). The reducer trusts the caller's gate.
      return {
        state: {
          kind: 'moving',
          slotId: action.slotId,
          durationMinutes: action.durationMinutes,
          originYmd: action.coords.ymd,
          originHalfHour: clampHalfHour(action.coords.halfHour),
          currentYmd: action.coords.ymd,
          currentHalfHour: clampHalfHour(action.coords.halfHour),
        },
        effect: null,
      }
    }

    case 'cellMouseEnter': {
      if (state.kind === 'painting') {
        // Single-day clamp — drift across columns is ignored.
        // Codex 2026-05-08 invariant: paint stays on the column it
        // started on. The user can re-mousedown elsewhere to start
        // a new paint.
        if (action.coords.ymd !== state.ymd) {
          return { state, effect: null }
        }
        const newTo = clampHalfHour(action.coords.halfHour)
        if (newTo === state.toHalfHour) return { state, effect: null }
        return {
          state: { ...state, toHalfHour: newTo },
          effect: null,
        }
      }
      if (state.kind === 'moving') {
        // Move CAN cross days — operator might shift Mon → Tue.
        // The atomic UPDATE WHERE status='open' on the server side
        // takes the snapshot or 409s. UI just tracks where the
        // cursor is.
        return {
          state: {
            ...state,
            currentYmd: action.coords.ymd,
            currentHalfHour: clampHalfHour(action.coords.halfHour),
          },
          effect: null,
        }
      }
      return { state, effect: null }
    }

    case 'mouseUp': {
      if (state.kind === 'painting') {
        // Paint span is always normalized so from <= to. The user
        // may have dragged upward; we sort here so synthesizers
        // downstream don't need to.
        const lo = Math.min(state.fromHalfHour, state.toHalfHour)
        const hi = Math.max(state.fromHalfHour, state.toHalfHour)
        return {
          state: { kind: 'idle' },
          effect: {
            kind: 'paintCommit',
            span: { ymd: state.ymd, fromHalfHour: lo, toHalfHour: hi },
          },
        }
      }
      if (state.kind === 'moving') {
        // No-op move (cursor never left origin) → cancel silently.
        if (
          state.currentYmd === state.originYmd &&
          state.currentHalfHour === state.originHalfHour
        ) {
          return { state: { kind: 'idle' }, effect: null }
        }
        return {
          state: { kind: 'idle' },
          effect: {
            kind: 'moveCommit',
            target: {
              slotId: state.slotId,
              durationMinutes: state.durationMinutes,
              originYmd: state.originYmd,
              originHalfHour: state.originHalfHour,
              newYmd: state.currentYmd,
              newHalfHour: state.currentHalfHour,
            },
          },
        }
      }
      return { state, effect: null }
    }
  }
}
