// @vitest-environment jsdom

// 2026-06-14 teacher-calendar-mouse-fix wave self-review BLOCKER —
// `dragResetSignal` effect must NOT re-fire on parent re-renders.
//
// The parent (`app/teacher/calendar/client.tsx`) passes `interactions`
// as an inline object, so its identity changes on every render. That
// in turn churns the `dispatch` callback identity. Without the
// `lastResetSignalRef` guard, the useEffect would re-run on every
// toast tick or reloadCounter bump and wipe `pendingPaintRef` mid-
// drag — cancelling the active paint silently.
//
// This test re-renders the SlotCalendar with the SAME `dragResetSignal`
// value and a NEW `interactions` object, then asserts a drag-paint
// flow still commits a span. With the bug present, the second render
// would clear `pendingPaintRef` between `mousedown` and `mouseup`, so
// the commit would never fire.

import { fireEvent, render, waitFor } from '@testing-library/react'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('@/components/calendar/MobileFallback', () => ({
  MobileFallback: () => null,
  useNarrowContainer: () => false,
}))

import { SlotCalendar } from '@/components/calendar/SlotCalendar'
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

describe('SlotCalendar dragResetSignal re-fire guard', () => {
  it('drag-paint survives a parent re-render with unchanged signal but new interactions', async () => {
    const onPaintSpan = vi.fn()
    // Render with signal=2 (i.e. modal opened twice before; non-zero).
    const interactionsV1 = { onPaintSpan }
    const { container, rerender } = render(
      <SlotCalendar
        teacherId={TEACHER_ID}
        initialFromYmd={FROM_YMD}
        interactions={interactionsV1}
        dragResetSignal={2}
      />,
    )
    const day = await findDayColumn(container, FROM_YMD)

    // Start drag: mousedown + cross threshold.
    fireEvent.mouseDown(day, { clientX: 130, clientY: 200 })
    fireEvent.mouseMove(document, { clientX: 130, clientY: 210 })

    // Now simulate a parent re-render with a NEW interactions object
    // (same shape, same `onPaintSpan` ref) but the SAME signal value.
    // The old useEffect-without-ref would re-run here and wipe the
    // anchor; with the guard, it stays put.
    const interactionsV2 = { onPaintSpan }
    rerender(
      <SlotCalendar
        teacherId={TEACHER_ID}
        initialFromYmd={FROM_YMD}
        interactions={interactionsV2}
        dragResetSignal={2}
      />,
    )

    // Complete the drag — mouseup should commit the span.
    fireEvent.mouseUp(document, { clientX: 130, clientY: 210 })

    expect(onPaintSpan).toHaveBeenCalledTimes(1)
  })

  it('still resets when the signal value actually changes (modal opens)', async () => {
    const onPaintSpan = vi.fn()
    const { container, rerender } = render(
      <SlotCalendar
        teacherId={TEACHER_ID}
        initialFromYmd={FROM_YMD}
        interactions={{ onPaintSpan }}
        dragResetSignal={1}
      />,
    )
    const day = await findDayColumn(container, FROM_YMD)

    // Start a drag.
    fireEvent.mouseDown(day, { clientX: 130, clientY: 200 })
    fireEvent.mouseMove(document, { clientX: 130, clientY: 210 })

    // Parent opens a modal → signal bumps. Effect MUST clear the
    // anchor + reset reducer so the trailing mouseup doesn't commit
    // a span the user no longer wants.
    rerender(
      <SlotCalendar
        teacherId={TEACHER_ID}
        initialFromYmd={FROM_YMD}
        interactions={{ onPaintSpan }}
        dragResetSignal={2}
      />,
    )

    fireEvent.mouseUp(document, { clientX: 130, clientY: 210 })

    expect(onPaintSpan).not.toHaveBeenCalled()
  })
})
