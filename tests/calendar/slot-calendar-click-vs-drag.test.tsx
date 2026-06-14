// @vitest-environment jsdom

// 2026-06-14 teacher-calendar-mouse-fix BUG-1 — click-vs-drag pixel
// threshold. Owner reported every single click on an empty calendar
// cell opens PaintConfirmModal with a broken «Диапазон короче выбранной
// длительности» banner. Root cause: `SlotCalendar`'s reducer entered
// `painting` state on every mousedown and committed a 1-cell paint
// span on every mouseup, regardless of cursor movement. Fix: defer
// the `cellMouseDown` dispatch until the document-level mousemove
// confirms the cursor crossed MOUSE_DRAG_THRESHOLD_PX (5px Chebyshev).
//
// These tests pin the threshold behavior at the wiring layer. The
// reducer itself is still tested for its pure semantics in
// `tests/calendar/drag-state.test.ts`.

import { fireEvent, render, waitFor } from '@testing-library/react'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

// `useNarrowContainer` reads `getBoundingClientRect().width` to decide
// between the desktop grid and the mobile fallback. jsdom doesn't run
// layout, so width is always 0 → fallback would render and there would
// be no day columns to hit-test. We force the desktop path here.
vi.mock('@/components/calendar/MobileFallback', () => ({
  MobileFallback: () => null,
  useNarrowContainer: () => false,
}))

import {
  MOUSE_DRAG_THRESHOLD_PX,
  SlotCalendar,
} from '@/components/calendar/SlotCalendar'
import type { CalendarResponse } from '@/lib/calendar/types'

const TEACHER_ID = 'teacher-fixture'
const FROM_YMD = '2026-05-18'

const EMPTY_RESPONSE: CalendarResponse = {
  generatedAt: '2026-05-18T09:00:00.000Z',
  fromYmd: FROM_YMD,
  toYmd: '2026-05-25',
  teacherId: TEACHER_ID,
  slots: [],
}

beforeAll(() => {
  globalThis.fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => EMPTY_RESPONSE,
  })) as unknown as typeof fetch
  // jsdom doesn't ship ResizeObserver; SlotCalendar > MobileFallback
  // uses it to decide whether to render a mobile fallback. We always
  // want the full grid in these tests, so the stub is a no-op.
  class NoopResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  ;(globalThis as unknown as { ResizeObserver: typeof NoopResizeObserver }).ResizeObserver =
    NoopResizeObserver
})
afterAll(() => {
  vi.restoreAllMocks()
})

async function findDayColumn(
  container: HTMLElement,
  ymd: string,
): Promise<HTMLElement> {
  // SlotCalendar fetches on mount and the day columns only render
  // after the response resolves. Wait for the column to appear, then
  // stub its rect so the wiring-layer hit-test math works under jsdom.
  const el = await waitFor(() => {
    const candidate = container.querySelector<HTMLElement>(
      `[aria-label="День ${ymd}"]`,
    )
    if (!candidate) throw new Error(`Day column ${ymd} not yet mounted`)
    return candidate
  })
  el.getBoundingClientRect = () =>
    ({
      left: 100,
      right: 200,
      top: 100,
      bottom: 1300,
      width: 100,
      height: 1200,
      x: 100,
      y: 100,
      toJSON: () => ({}),
    }) as DOMRect
  return el
}

describe('SlotCalendar click-vs-drag threshold', () => {
  it('exports a sensible default threshold', () => {
    expect(MOUSE_DRAG_THRESHOLD_PX).toBeGreaterThanOrEqual(4)
    expect(MOUSE_DRAG_THRESHOLD_PX).toBeLessThanOrEqual(10)
  })

  it('does NOT commit a paint span on a pure click (no movement)', async () => {
    const onPaintSpan = vi.fn()
    const { container } = render(
      <SlotCalendar
        teacherId={TEACHER_ID}
        initialFromYmd={FROM_YMD}
        interactions={{ onPaintSpan }}
      />,
    )
    const day = await findDayColumn(container, FROM_YMD)
    // Press on the day column at (130, 200) — mid-column, roughly
    // 06:00. No movement before release.
    fireEvent.mouseDown(day, { clientX: 130, clientY: 200 })
    fireEvent.mouseUp(document, { clientX: 130, clientY: 200 })

    expect(onPaintSpan).not.toHaveBeenCalled()
  })

  it('does NOT commit when cursor moves under threshold', async () => {
    const onPaintSpan = vi.fn()
    const { container } = render(
      <SlotCalendar
        teacherId={TEACHER_ID}
        initialFromYmd={FROM_YMD}
        interactions={{ onPaintSpan }}
      />,
    )
    const day = await findDayColumn(container, FROM_YMD)
    fireEvent.mouseDown(day, { clientX: 130, clientY: 200 })
    // Move 3px diagonally — below 5px Chebyshev threshold.
    fireEvent.mouseMove(document, { clientX: 133, clientY: 203 })
    fireEvent.mouseUp(document, { clientX: 133, clientY: 203 })

    expect(onPaintSpan).not.toHaveBeenCalled()
  })

  it('commits a paint span once the cursor crosses the threshold', async () => {
    const onPaintSpan = vi.fn()
    const { container } = render(
      <SlotCalendar
        teacherId={TEACHER_ID}
        initialFromYmd={FROM_YMD}
        interactions={{ onPaintSpan }}
      />,
    )
    const day = await findDayColumn(container, FROM_YMD)
    fireEvent.mouseDown(day, { clientX: 130, clientY: 200 })
    // Move 10px below — supra-threshold; promotes anchor + extends span.
    fireEvent.mouseMove(document, { clientX: 130, clientY: 210 })
    fireEvent.mouseUp(document, { clientX: 130, clientY: 210 })

    expect(onPaintSpan).toHaveBeenCalledTimes(1)
    const span = onPaintSpan.mock.calls[0][0]
    expect(span.ymd).toBe(FROM_YMD)
    expect(typeof span.fromHalfHour).toBe('number')
    expect(typeof span.toHalfHour).toBe('number')
  })

  it('keeps drag-paint working for multi-cell spans', async () => {
    const onPaintSpan = vi.fn()
    const { container } = render(
      <SlotCalendar
        teacherId={TEACHER_ID}
        initialFromYmd={FROM_YMD}
        interactions={{ onPaintSpan }}
      />,
    )
    const day = await findDayColumn(container, FROM_YMD)
    fireEvent.mouseDown(day, { clientX: 130, clientY: 200 })
    // Step 1: cross threshold to promote anchor.
    fireEvent.mouseMove(document, { clientX: 130, clientY: 210 })
    // Step 2: continue dragging further down to expand the span.
    fireEvent.mouseMove(document, { clientX: 130, clientY: 320 })
    fireEvent.mouseUp(document, { clientX: 130, clientY: 320 })

    expect(onPaintSpan).toHaveBeenCalledTimes(1)
    const span = onPaintSpan.mock.calls[0][0]
    expect(span.toHalfHour).toBeGreaterThan(span.fromHalfHour)
  })
})
