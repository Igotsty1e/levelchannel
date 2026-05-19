// @vitest-environment jsdom

// BCS-DEF-1-COPY-STYLE-SWEEP item 1 (2026-05-19) — RTL pins for the
// slot-ID column on /admin/slots. The conflict-unresolved alert email
// (scripts/conflict-unresolved-alert.mjs) lists slot UUIDs in its body
// so on-call operators can match a probe finding to a row on this
// page. The column surfaces a short prefix (visual scan) + a "copy"
// button that puts the full UUID on the clipboard.
//
// What this test pins (DOM-level contract, jsdom does not compute CSS):
//   1. The column header "ID" is present.
//   2. The visible label is the shortened ID (first 8 hex chars), not
//      the full UUID — so the column stays narrow.
//   3. The full UUID is reachable for operator copy (via `title` on
//      the <code>) — keeps the manual-select-and-copy fallback honest
//      even if the clipboard API is unavailable.
//   4. The "copy" button is present with `aria-label="Скопировать ID
//      слота"` and calls `navigator.clipboard.writeText(<full-uuid>)`.
//
// Hermetic: navigator.clipboard.writeText is a vi.fn() — no real
// clipboard interaction. RTL toolchain via SAAS-INFRA-1
// (tests/setup-rtl.ts).

import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SlotsManager } from '@/app/admin/(gated)/slots/slots-manager'
import type { LessonSlot } from '@/lib/scheduling/slots'

const SLOT_UUID = '7d3a2b1c-1111-4222-8333-444455556666'
const SHORT_PREFIX = '7d3a2b1c'

function makeSlot(): LessonSlot {
  return {
    id: SLOT_UUID,
    teacherAccountId: 'tt-1',
    teacherEmail: 'teacher@example.com',
    startAt: '2026-05-20T11:00:00.000Z',
    durationMinutes: 60,
    status: 'open',
    learnerAccountId: null,
    learnerEmail: null,
    bookedAt: null,
    cancelledAt: null,
    cancelledByAccountId: null,
    cancellationReason: null,
    markedAt: null,
    tariffId: null,
    tariffSlug: null,
    tariffTitleRu: null,
    tariffAmountKopecks: null,
    notes: null,
  }
}

function renderManager(slot: LessonSlot = makeSlot()) {
  return render(
    <SlotsManager
      initialTeachers={[{ id: 'tt-1', email: 'teacher@example.com' }]}
      initialSlots={[slot]}
      initialTariffs={[]}
      initialLearners={[]}
    />,
  )
}

describe('SlotsManager — slot-ID column (BCS-DEF-1-COPY-STYLE-SWEEP item 1)', () => {
  let writeText: ReturnType<typeof vi.fn>

  beforeEach(() => {
    writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
  })

  it('renders an "ID" column header', () => {
    renderManager()
    const headerCells = screen.getAllByRole('columnheader')
    const idHeader = headerCells.find(
      (th) => th.textContent?.trim() === 'ID',
    )
    expect(idHeader).toBeDefined()
  })

  it('shows the shortened ID (first UUID segment) as the visible label, not the full UUID', () => {
    const { container } = renderManager()
    const codeEl = container.querySelector('[data-testid="slot-id-short"]')
    expect(codeEl).not.toBeNull()
    expect(codeEl?.textContent).toBe(SHORT_PREFIX)
    // The visible label must NOT be the full UUID — otherwise the
    // column eats horizontal space and the "short prefix" design
    // claim is a lie.
    expect(codeEl?.textContent).not.toBe(SLOT_UUID)
  })

  it('keeps the full UUID reachable via the `title` attribute on the short label', () => {
    const { container } = renderManager()
    const codeEl = container.querySelector('[data-testid="slot-id-short"]')
    expect(codeEl?.getAttribute('title')).toBe(SLOT_UUID)
  })

  it('renders a copy button with the Russian aria-label "Скопировать ID слота"', () => {
    renderManager()
    const btn = screen.getByRole('button', { name: 'Скопировать ID слота' })
    expect(btn).not.toBeNull()
  })

  it('click on copy button calls navigator.clipboard.writeText with the FULL UUID (not the prefix)', () => {
    renderManager()
    const btn = screen.getByRole('button', { name: 'Скопировать ID слота' })
    fireEvent.click(btn)
    expect(writeText).toHaveBeenCalledTimes(1)
    expect(writeText).toHaveBeenCalledWith(SLOT_UUID)
    // Anti-regression: passing the short prefix would defeat the
    // whole point of the copy button (psql lookup needs the full
    // UUID).
    expect(writeText).not.toHaveBeenCalledWith(SHORT_PREFIX)
  })
})
