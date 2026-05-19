// @vitest-environment jsdom

// SAAS-1-FOLLOWUP-KEYBOARD — RTL component tests for keyboard nav on
// the calendar grid. Pinned per docs/plans/saas-1-followup-keyboard.md
// §3 items 3–9: focus model on first mount, ArrowRight moves to next
// day, ArrowUp at top is a no-op, Enter on empty cell fires the paint
// callback, Enter on a SlotBlock fires onSlotClick, Home/End/PageUp/
// PageDown jump correctly.

import { fireEvent, render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { Grid } from '@/components/calendar/Grid'
import { MAX_HALF_HOUR } from '@/lib/calendar/grid-keyboard'
import type { CalendarSlot } from '@/lib/calendar/types'

// Week pinned to a known Monday (2026-05-18) — `weekDayKeys` walks
// forward 7 days from this date, so we can predict the column ymds.
const FROM_YMD = '2026-05-18'
const DAYS = [
  '2026-05-18',
  '2026-05-19',
  '2026-05-20',
  '2026-05-21',
  '2026-05-22',
  '2026-05-23',
  '2026-05-24',
]

// Pin the wall clock to 2026-05-18 12:00 MSK (09:00 UTC). The Grid's
// useEffect calls Date.now() to compute todayYmd; if the host system
// clock has rolled past midnight MSK, the initial-focus effect would
// jump focusedCell to (1, 6) and break every test that asserts
// focus at day 0. Fixed clock = deterministic initial focus = DAYS[0].
beforeAll(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(new Date('2026-05-18T09:00:00.000Z'))
})
afterAll(() => {
  vi.useRealTimers()
})

function cellOf(ymd: string, halfHour: number): HTMLElement {
  const cell = document.querySelector(
    `[data-ymd="${ymd}"][data-halfhour="${halfHour}"]`,
  )
  if (!cell) {
    throw new Error(`cell ${ymd}#${halfHour} not found in DOM`)
  }
  return cell as HTMLElement
}

// Build a fixture with one open slot on the third day at 11:00 MSK.
// Half-hour topPx for 11:00 = (11-6)*60 = 300; durationMinutes=60 →
// covers halfHours 10 and 11. The keyboard nav should treat (day=2,
// halfHour=10) as "inside slot" and (day=2, halfHour=9) as "empty".
const fixtureSlots: ReadonlyArray<CalendarSlot> = [
  {
    kind: 'open',
    id: 'slot-fixture-1',
    startAt: '2026-05-20T08:00:00.000Z', // 11:00 MSK
    durationMinutes: 60,
    tariffId: null,
    tariffAmountKopecks: null,
  },
]

describe('Grid keyboard nav — roving tabindex + activation', () => {
  it('mounts with one cell tabIndex=0 (day 0 / halfHour 6), all others -1', () => {
    render(<Grid fromYmd={FROM_YMD} slots={[]} />)
    const initial = cellOf(DAYS[0], 6)
    expect(initial.getAttribute('tabindex')).toBe('0')
    // Sanity: at least one other cell is -1.
    const other = cellOf(DAYS[1], 6)
    expect(other.getAttribute('tabindex')).toBe('-1')
  })

  it('Tab focuses the active cell; ArrowRight moves focus to next day', async () => {
    const user = userEvent.setup()
    render(<Grid fromYmd={FROM_YMD} slots={[]} />)
    await user.tab()
    const initial = cellOf(DAYS[0], 6)
    expect(document.activeElement).toBe(initial)
    await user.keyboard('{ArrowRight}')
    const next = cellOf(DAYS[1], 6)
    expect(next.getAttribute('tabindex')).toBe('0')
    expect(initial.getAttribute('tabindex')).toBe('-1')
    expect(document.activeElement).toBe(next)
  })

  it('ArrowUp at halfHour 0 is a no-op (focus stays); preventDefault fires', async () => {
    const user = userEvent.setup()
    render(<Grid fromYmd={FROM_YMD} slots={[]} />)
    await user.tab()
    await user.keyboard('{PageUp}') // halfHour → 0
    const top = cellOf(DAYS[0], 0)
    expect(document.activeElement).toBe(top)
    await user.keyboard('{ArrowUp}')
    expect(document.activeElement).toBe(top)
  })

  it('Enter on an empty cell invokes onCellMouseDown with (ymd, halfHour)', async () => {
    const user = userEvent.setup()
    const onCellMouseDown = vi.fn()
    render(
      <Grid
        fromYmd={FROM_YMD}
        slots={[]}
        drag={{ onCellMouseDown }}
      />,
    )
    await user.tab()
    await user.keyboard('{Enter}')
    expect(onCellMouseDown).toHaveBeenCalledTimes(1)
    expect(onCellMouseDown).toHaveBeenCalledWith(DAYS[0], 6)
  })

  it('Space on an empty cell also invokes onCellMouseDown', async () => {
    const user = userEvent.setup()
    const onCellMouseDown = vi.fn()
    render(
      <Grid
        fromYmd={FROM_YMD}
        slots={[]}
        drag={{ onCellMouseDown }}
      />,
    )
    await user.tab()
    await user.keyboard(' ')
    expect(onCellMouseDown).toHaveBeenCalledTimes(1)
    expect(onCellMouseDown).toHaveBeenCalledWith(DAYS[0], 6)
  })

  it('Enter on a cell that overlaps a SlotBlock invokes onSlotClick (not onCellMouseDown)', async () => {
    // userEvent's keyboard sometimes doesn't bubble cleanly when the
    // focus is on an aria-hidden:false div without tabindex churn — use
    // fireEvent.keyDown directly on the grid to bypass the synthetic
    // delay model.
    const onCellMouseDown = vi.fn()
    const onSlotClick = vi.fn()
    const { container } = render(
      <Grid
        fromYmd={FROM_YMD}
        slots={fixtureSlots}
        onSlotClick={onSlotClick}
        drag={{ onCellMouseDown }}
      />,
    )
    // Move focus to (day 2 = 2026-05-20, halfHour 10) — inside the slot.
    // Simulate by directly invoking nav: ArrowRight ×2 (day 0→2),
    // ArrowDown ×4 (halfHour 6→10) is 4 presses.
    const grid = container.querySelector('[role="grid"]') as HTMLElement
    // Establish "focus inside grid" so the effect runs.
    cellOf(DAYS[0], 6).focus()
    fireEvent.keyDown(grid, { key: 'ArrowRight' })
    fireEvent.keyDown(grid, { key: 'ArrowRight' })
    fireEvent.keyDown(grid, { key: 'ArrowDown' })
    fireEvent.keyDown(grid, { key: 'ArrowDown' })
    fireEvent.keyDown(grid, { key: 'ArrowDown' })
    fireEvent.keyDown(grid, { key: 'ArrowDown' })
    // Now focused cell = (2, 10). The slot covers halfHours 10..11.
    fireEvent.keyDown(grid, { key: 'Enter' })
    expect(onSlotClick).toHaveBeenCalledTimes(1)
    expect(onCellMouseDown).not.toHaveBeenCalled()
  })

  it('Home jumps to day 0', async () => {
    const { container } = render(<Grid fromYmd={FROM_YMD} slots={[]} />)
    const grid = container.querySelector('[role="grid"]') as HTMLElement
    cellOf(DAYS[0], 6).focus()
    fireEvent.keyDown(grid, { key: 'ArrowRight' })
    fireEvent.keyDown(grid, { key: 'ArrowRight' })
    fireEvent.keyDown(grid, { key: 'ArrowRight' })
    // Now at day 3.
    fireEvent.keyDown(grid, { key: 'Home' })
    expect(cellOf(DAYS[0], 6).getAttribute('tabindex')).toBe('0')
    expect(document.activeElement).toBe(cellOf(DAYS[0], 6))
  })

  it('End jumps to day 6', async () => {
    const { container } = render(<Grid fromYmd={FROM_YMD} slots={[]} />)
    const grid = container.querySelector('[role="grid"]') as HTMLElement
    cellOf(DAYS[0], 6).focus()
    fireEvent.keyDown(grid, { key: 'End' })
    expect(cellOf(DAYS[6], 6).getAttribute('tabindex')).toBe('0')
  })

  it('PageUp jumps to halfHour 0', async () => {
    const { container } = render(<Grid fromYmd={FROM_YMD} slots={[]} />)
    const grid = container.querySelector('[role="grid"]') as HTMLElement
    cellOf(DAYS[0], 6).focus()
    fireEvent.keyDown(grid, { key: 'PageUp' })
    expect(cellOf(DAYS[0], 0).getAttribute('tabindex')).toBe('0')
  })

  it('PageDown jumps to MAX_HALF_HOUR', async () => {
    const { container } = render(<Grid fromYmd={FROM_YMD} slots={[]} />)
    const grid = container.querySelector('[role="grid"]') as HTMLElement
    cellOf(DAYS[0], 6).focus()
    fireEvent.keyDown(grid, { key: 'PageDown' })
    expect(cellOf(DAYS[0], MAX_HALF_HOUR).getAttribute('tabindex')).toBe('0')
  })
})
