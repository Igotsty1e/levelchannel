// @vitest-environment jsdom

// 2026-06-14 teacher-calendar-mouse-fix BUG-2 — every modal/sheet
// surface on /teacher/calendar is driven by a single discriminated
// union state machine (`CalendarModalState`). By construction at
// most one modal can be mounted at any time, killing the
// «закрываешь — предлагает занятия назначить» class of bugs
// caused by three independent useState flags.
//
// This test pins the single-modal invariant from the page level:
// top-row buttons get disabled when a modal is open, and every
// transition leaves exactly one (or zero) [role="dialog"] in the DOM.

import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// `useRouter` from next/navigation only runs inside the Next runtime;
// the component just needs `router.refresh()` not to crash.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {} }),
}))

// Mock SlotCalendar so the test doesn't have to fight grid layout,
// fetch responses, or the document-level drag listeners. We render a
// minimal stub that exposes test seams for slot click + paint span
// commit.
vi.mock('@/components/calendar/SlotCalendar', () => ({
  SlotCalendar: ({
    onSlotClick,
    interactions,
    headerActions,
  }: {
    onSlotClick?: (row: unknown) => void
    interactions?: { onPaintSpan?: (span: unknown) => void }
    headerActions?: React.ReactNode
  }) => (
    <div data-testid="slot-calendar-stub">
      {/* 2026-06-23 — single-row header CTAs теперь приходят через
          headerActions slot из page client → SlotCalendar → Toolbar.
          Mock рендерит их inline чтобы single-modal invariant
          assertions могли их найти. */}
      {headerActions ? <div data-testid="header-actions">{headerActions}</div> : null}
      <button
        type="button"
        data-testid="stub-fire-slot-click"
        onClick={() =>
          onSlotClick?.({
            slot: {
              kind: 'open',
              id: 'slot-1',
              durationMinutes: 60,
              tariffAmountKopecks: null,
            },
            dayYmd: '2026-05-18',
            startLabel: '10:00',
            endLabel: '11:00',
            topPx: 0,
            heightPx: 60,
          })
        }
      >
        fire slot click
      </button>
      <button
        type="button"
        data-testid="stub-fire-paint-span"
        onClick={() =>
          interactions?.onPaintSpan?.({
            ymd: '2026-05-18',
            fromHalfHour: 0,
            toHalfHour: 1,
          })
        }
      >
        fire paint span
      </button>
    </div>
  ),
}))

import TeacherCalendarClient from '@/app/teacher/calendar/client'

const TARIFFS = [
  {
    id: 'tariff-1',
    slug: 'standard',
    titleRu: 'Стандарт',
    amountKopecks: 100000,
    durationMinutes: 60,
  },
]

beforeEach(() => {
  globalThis.fetch = vi.fn(() => new Promise(() => {})) as unknown as typeof fetch
})
afterEach(() => {
  vi.restoreAllMocks()
})

function getTopRowButtons() {
  return {
    assign: screen.getByRole('button', { name: '+ Назначить ученику' }),
    bulk: screen.getByRole('button', { name: '+ Добавить слоты' }),
  }
}

function dialogCount() {
  return screen.queryAllByRole('dialog').length
}

describe('TeacherCalendarClient single-modal invariant (BUG-2)', () => {
  it('starts with no modal open and both top-row buttons enabled', () => {
    render(
      <TeacherCalendarClient
        teacherId="teacher-1"
        initialFromYmd="2026-05-18"
        tariffs={TARIFFS}
      />,
    )
    expect(dialogCount()).toBe(0)
    const { assign, bulk } = getTopRowButtons()
    expect(assign).not.toBeDisabled()
    expect(bulk).not.toBeDisabled()
  })

  it('opening AssignDirectModal disables both top-row buttons', () => {
    render(
      <TeacherCalendarClient
        teacherId="teacher-1"
        initialFromYmd="2026-05-18"
        tariffs={TARIFFS}
      />,
    )
    fireEvent.click(getTopRowButtons().assign)
    expect(dialogCount()).toBe(1)
    const after = getTopRowButtons()
    expect(after.assign).toBeDisabled()
    expect(after.bulk).toBeDisabled()
  })

  it('opening BulkAddSlotsModal disables both top-row buttons', () => {
    render(
      <TeacherCalendarClient
        teacherId="teacher-1"
        initialFromYmd="2026-05-18"
        tariffs={TARIFFS}
      />,
    )
    fireEvent.click(getTopRowButtons().bulk)
    expect(dialogCount()).toBe(1)
    const after = getTopRowButtons()
    expect(after.assign).toBeDisabled()
    expect(after.bulk).toBeDisabled()
  })

  it('slot click opens exactly one modal', () => {
    render(
      <TeacherCalendarClient
        teacherId="teacher-1"
        initialFromYmd="2026-05-18"
        tariffs={TARIFFS}
      />,
    )
    fireEvent.click(screen.getByTestId('stub-fire-slot-click'))
    expect(dialogCount()).toBe(1)
  })

  it('paint-span commit opens exactly one modal', () => {
    render(
      <TeacherCalendarClient
        teacherId="teacher-1"
        initialFromYmd="2026-05-18"
        tariffs={TARIFFS}
      />,
    )
    fireEvent.click(screen.getByTestId('stub-fire-paint-span'))
    expect(dialogCount()).toBe(1)
  })

  it('paint-span commit is dropped while a modal is already open', () => {
    render(
      <TeacherCalendarClient
        teacherId="teacher-1"
        initialFromYmd="2026-05-18"
        tariffs={TARIFFS}
      />,
    )
    // 1. Open AssignDirectModal first.
    fireEvent.click(getTopRowButtons().assign)
    expect(dialogCount()).toBe(1)
    // 2. Background paint-span fires (race scenario). It must be
    //    dropped — still exactly one modal mounted.
    fireEvent.click(screen.getByTestId('stub-fire-paint-span'))
    expect(dialogCount()).toBe(1)
  })

  it('slot click is dropped while a modal is already open', () => {
    render(
      <TeacherCalendarClient
        teacherId="teacher-1"
        initialFromYmd="2026-05-18"
        tariffs={TARIFFS}
      />,
    )
    fireEvent.click(getTopRowButtons().bulk)
    expect(dialogCount()).toBe(1)
    fireEvent.click(screen.getByTestId('stub-fire-slot-click'))
    expect(dialogCount()).toBe(1)
  })
})
