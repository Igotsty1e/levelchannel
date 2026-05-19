// @vitest-environment jsdom

// SAAS-INFRA-1 smoke test — proves the jsdom + RTL toolchain works
// against a real component from the codebase. Doubles as the first
// render-coverage data point for components/calendar/SlotBlock.tsx
// (the className-composition seam at SlotBlock.tsx:42-44).
//
// Per docs/plans/saas-infra-1-jsdom-rtl.md §2.4: the toolchain is
// validated when ONE rendering assertion lands on a real DOM. The
// downstream coverage-PR (#2 in §5) deepens this with the conflict-
// overlay matrix and a shared fixture helper.

// Note: jest-dom matchers are loaded globally via tests/setup-rtl.ts
// (which uses the explicit `@testing-library/jest-dom/matchers` ESM
// subpath import — see plan-doc R3 for why the bare import would auto-
// install against the wrong `expect`). Tests that just need `expect`
// + render can drop the matcher import here entirely.

import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { SlotBlock } from '@/components/calendar/SlotBlock'
import type { CalendarSlot } from '@/lib/calendar/types'
import type { CalendarRow } from '@/lib/calendar/view-model'

function fixtureRow(slot: CalendarSlot): CalendarRow {
  return {
    slot,
    startLabel: '14:00',
    endLabel: '15:00',
    topPx: 0,
    heightPx: 60,
    dayYmd: '2026-05-20',
  }
}

const baseOpenSlot: CalendarSlot = {
  kind: 'open',
  id: 'slot-open-1',
  startAt: '2026-05-20T11:00:00.000Z',
  durationMinutes: 60,
  tariffId: null,
  tariffAmountKopecks: null,
}

const baseBookedSelfSlot: CalendarSlot = {
  kind: 'booked-self',
  id: 'slot-self-1',
  startAt: '2026-05-20T11:00:00.000Z',
  durationMinutes: 60,
  tariffId: null,
  tariffAmountKopecks: null,
}

describe('SlotBlock — palette class per kind (SAAS-INFRA-1 jsdom integration smoke test)', () => {
  it('renders booked-self slot with calendar-slot-booked-self class', () => {
    const { container } = render(<SlotBlock row={fixtureRow(baseBookedSelfSlot)} />)
    const btn = container.querySelector('button.calendar-slot-block')
    expect(btn).not.toBeNull()
    expect(btn?.className).toContain('calendar-slot-booked-self')
  })

  it('renders open slot with calendar-slot-open class', () => {
    const { container } = render(<SlotBlock row={fixtureRow(baseOpenSlot)} />)
    const btn = container.querySelector('button.calendar-slot-block')
    expect(btn).not.toBeNull()
    expect(btn?.className).toContain('calendar-slot-open')
  })
})
