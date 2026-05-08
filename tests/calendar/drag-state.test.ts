import { describe, expect, it } from 'vitest'

import {
  type DragState,
  initialDragState,
  reduceDrag,
} from '@/lib/calendar/drag-state'

// PR3b — drag-state reducer invariants. Codex 2026-05-08 prescribed
// the test set: single-day clamp, move only with caller gating,
// derived starts on 30-min grid (covered in paint-synth.test), error
// → idle (covered in caller wiring).

describe('reduceDrag — idle baseline', () => {
  it('cellMouseEnter while idle is a no-op', () => {
    const r = reduceDrag(initialDragState, {
      type: 'cellMouseEnter',
      coords: { ymd: '2026-05-11', halfHour: 24 },
    })
    expect(r.state.kind).toBe('idle')
    expect(r.effect).toBeNull()
  })

  it('mouseUp while idle is a no-op', () => {
    const r = reduceDrag(initialDragState, { type: 'mouseUp' })
    expect(r.state.kind).toBe('idle')
    expect(r.effect).toBeNull()
  })

  it('escape while idle stays idle', () => {
    const r = reduceDrag(initialDragState, { type: 'escape' })
    expect(r.state.kind).toBe('idle')
    expect(r.effect).toBeNull()
  })
})

describe('reduceDrag — paint lifecycle', () => {
  it('cellMouseDown enters painting at the anchor cell', () => {
    const r = reduceDrag(initialDragState, {
      type: 'cellMouseDown',
      coords: { ymd: '2026-05-11', halfHour: 24 },
    })
    expect(r.state.kind).toBe('painting')
    if (r.state.kind === 'painting') {
      expect(r.state.ymd).toBe('2026-05-11')
      expect(r.state.fromHalfHour).toBe(24)
      expect(r.state.toHalfHour).toBe(24)
    }
    expect(r.effect).toBeNull()
  })

  it('cellMouseEnter on the same day extends paint', () => {
    let s: DragState = initialDragState
    s = reduceDrag(s, {
      type: 'cellMouseDown',
      coords: { ymd: '2026-05-11', halfHour: 24 },
    }).state
    s = reduceDrag(s, {
      type: 'cellMouseEnter',
      coords: { ymd: '2026-05-11', halfHour: 27 },
    }).state
    expect(s.kind).toBe('painting')
    if (s.kind === 'painting') {
      expect(s.fromHalfHour).toBe(24)
      expect(s.toHalfHour).toBe(27)
    }
  })

  it('cellMouseEnter on a DIFFERENT day is ignored (single-day clamp)', () => {
    let s: DragState = initialDragState
    s = reduceDrag(s, {
      type: 'cellMouseDown',
      coords: { ymd: '2026-05-11', halfHour: 24 },
    }).state
    const r = reduceDrag(s, {
      type: 'cellMouseEnter',
      coords: { ymd: '2026-05-12', halfHour: 30 },
    })
    expect(r.state.kind).toBe('painting')
    if (r.state.kind === 'painting') {
      expect(r.state.ymd).toBe('2026-05-11') // unchanged
      expect(r.state.toHalfHour).toBe(24) // unchanged
    }
  })

  it('mouseUp emits paintCommit with normalized [lo, hi]', () => {
    let s: DragState = initialDragState
    s = reduceDrag(s, {
      type: 'cellMouseDown',
      coords: { ymd: '2026-05-11', halfHour: 28 },
    }).state
    // Drag UPWARD: from=28, to=24 (toHalfHour < fromHalfHour)
    s = reduceDrag(s, {
      type: 'cellMouseEnter',
      coords: { ymd: '2026-05-11', halfHour: 24 },
    }).state
    const r = reduceDrag(s, { type: 'mouseUp' })
    expect(r.state.kind).toBe('idle')
    expect(r.effect?.kind).toBe('paintCommit')
    if (r.effect?.kind === 'paintCommit') {
      expect(r.effect.span.fromHalfHour).toBe(24) // lo
      expect(r.effect.span.toHalfHour).toBe(28) // hi
      expect(r.effect.span.ymd).toBe('2026-05-11')
    }
  })

  it('escape during paint cancels back to idle, no effect', () => {
    let s: DragState = initialDragState
    s = reduceDrag(s, {
      type: 'cellMouseDown',
      coords: { ymd: '2026-05-11', halfHour: 24 },
    }).state
    const r = reduceDrag(s, { type: 'escape' })
    expect(r.state.kind).toBe('idle')
    expect(r.effect).toBeNull()
  })

  it('halfHour clamps to [0, 35]', () => {
    const r = reduceDrag(initialDragState, {
      type: 'cellMouseDown',
      coords: { ymd: '2026-05-11', halfHour: 99 },
    })
    expect(r.state.kind).toBe('painting')
    if (r.state.kind === 'painting') {
      expect(r.state.fromHalfHour).toBe(35)
      expect(r.state.toHalfHour).toBe(35)
    }
  })
})

describe('reduceDrag — move lifecycle', () => {
  it('slotMouseDown enters moving with origin at coords', () => {
    const r = reduceDrag(initialDragState, {
      type: 'slotMouseDown',
      slotId: 'slot-1',
      durationMinutes: 60,
      coords: { ymd: '2026-05-11', halfHour: 24 },
    })
    expect(r.state.kind).toBe('moving')
    if (r.state.kind === 'moving') {
      expect(r.state.slotId).toBe('slot-1')
      expect(r.state.durationMinutes).toBe(60)
      expect(r.state.originYmd).toBe('2026-05-11')
      expect(r.state.originHalfHour).toBe(24)
      expect(r.state.currentYmd).toBe('2026-05-11')
      expect(r.state.currentHalfHour).toBe(24)
    }
  })

  it('cellMouseEnter shifts current cell while moving', () => {
    let s: DragState = initialDragState
    s = reduceDrag(s, {
      type: 'slotMouseDown',
      slotId: 'slot-1',
      durationMinutes: 60,
      coords: { ymd: '2026-05-11', halfHour: 24 },
    }).state
    s = reduceDrag(s, {
      type: 'cellMouseEnter',
      coords: { ymd: '2026-05-11', halfHour: 28 },
    }).state
    expect(s.kind).toBe('moving')
    if (s.kind === 'moving') {
      expect(s.currentHalfHour).toBe(28)
      expect(s.originHalfHour).toBe(24)
    }
  })

  it('move CAN cross days (unlike paint)', () => {
    let s: DragState = initialDragState
    s = reduceDrag(s, {
      type: 'slotMouseDown',
      slotId: 'slot-1',
      durationMinutes: 60,
      coords: { ymd: '2026-05-11', halfHour: 24 },
    }).state
    s = reduceDrag(s, {
      type: 'cellMouseEnter',
      coords: { ymd: '2026-05-12', halfHour: 30 },
    }).state
    expect(s.kind).toBe('moving')
    if (s.kind === 'moving') {
      expect(s.currentYmd).toBe('2026-05-12')
      expect(s.currentHalfHour).toBe(30)
    }
  })

  it('mouseUp at origin (no-op move) returns to idle WITHOUT effect', () => {
    let s: DragState = initialDragState
    s = reduceDrag(s, {
      type: 'slotMouseDown',
      slotId: 'slot-1',
      durationMinutes: 60,
      coords: { ymd: '2026-05-11', halfHour: 24 },
    }).state
    const r = reduceDrag(s, { type: 'mouseUp' })
    expect(r.state.kind).toBe('idle')
    expect(r.effect).toBeNull()
  })

  it('mouseUp after drift emits moveCommit', () => {
    let s: DragState = initialDragState
    s = reduceDrag(s, {
      type: 'slotMouseDown',
      slotId: 'slot-1',
      durationMinutes: 60,
      coords: { ymd: '2026-05-11', halfHour: 24 },
    }).state
    s = reduceDrag(s, {
      type: 'cellMouseEnter',
      coords: { ymd: '2026-05-12', halfHour: 30 },
    }).state
    const r = reduceDrag(s, { type: 'mouseUp' })
    expect(r.state.kind).toBe('idle')
    expect(r.effect?.kind).toBe('moveCommit')
    if (r.effect?.kind === 'moveCommit') {
      expect(r.effect.target.slotId).toBe('slot-1')
      expect(r.effect.target.originYmd).toBe('2026-05-11')
      expect(r.effect.target.originHalfHour).toBe(24)
      expect(r.effect.target.newYmd).toBe('2026-05-12')
      expect(r.effect.target.newHalfHour).toBe(30)
      expect(r.effect.target.durationMinutes).toBe(60)
    }
  })

  it('escape during move cancels back to idle, no effect', () => {
    let s: DragState = initialDragState
    s = reduceDrag(s, {
      type: 'slotMouseDown',
      slotId: 'slot-1',
      durationMinutes: 60,
      coords: { ymd: '2026-05-11', halfHour: 24 },
    }).state
    s = reduceDrag(s, {
      type: 'cellMouseEnter',
      coords: { ymd: '2026-05-12', halfHour: 30 },
    }).state
    const r = reduceDrag(s, { type: 'escape' })
    expect(r.state.kind).toBe('idle')
    expect(r.effect).toBeNull()
  })
})

describe('reduceDrag — interaction exclusivity', () => {
  it('cellMouseDown DURING moving switches to painting (defensive idempotence)', () => {
    let s: DragState = initialDragState
    s = reduceDrag(s, {
      type: 'slotMouseDown',
      slotId: 'slot-1',
      durationMinutes: 60,
      coords: { ymd: '2026-05-11', halfHour: 24 },
    }).state
    const r = reduceDrag(s, {
      type: 'cellMouseDown',
      coords: { ymd: '2026-05-11', halfHour: 30 },
    })
    expect(r.state.kind).toBe('painting')
    expect(r.effect).toBeNull()
  })

  it('reset always returns to idle without effect', () => {
    let s: DragState = initialDragState
    s = reduceDrag(s, {
      type: 'cellMouseDown',
      coords: { ymd: '2026-05-11', halfHour: 24 },
    }).state
    const r = reduceDrag(s, { type: 'reset' })
    expect(r.state.kind).toBe('idle')
    expect(r.effect).toBeNull()
  })
})
