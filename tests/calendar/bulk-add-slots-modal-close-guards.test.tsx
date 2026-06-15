// @vitest-environment jsdom

// 2026-06-14 teacher-calendar-mouse-fix BUG-4 — ESC + backdrop click
// MUST NOT close BulkAddSlotsModal while a POST is in flight (create
// or preview). Before this fix, the close handlers fired
// unconditionally; the async setState would land after the modal
// unmounted and the next refresh would show slots quietly created in
// the background. Mirrors the `busy`-guarded pattern already used by
// PaintConfirmModal + AssignDirectModal.

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BulkAddSlotsModal } from '@/components/calendar/BulkAddSlotsModal'

const NOOP_TARIFFS: ReadonlyArray<{
  id: string
  slug: string
  titleRu: string
  amountKopecks: number
  durationMinutes?: number
}> = []

beforeEach(() => {
  // Default: every fetch hangs forever — lets us assert "modal stayed
  // open" without a race against an unmocked /api endpoint.
  globalThis.fetch = vi.fn(() => new Promise(() => {})) as unknown as typeof fetch
})
afterEach(() => {
  vi.restoreAllMocks()
})

function renderModal(overrides?: {
  onClose?: () => void
  onCreated?: () => void
}) {
  const onClose = overrides?.onClose ?? vi.fn()
  const onCreated = overrides?.onCreated ?? vi.fn()
  render(
    <BulkAddSlotsModal
      open
      onClose={onClose}
      onCreated={onCreated}
      tariffs={NOOP_TARIFFS}
    />,
  )
  return { onClose, onCreated }
}

describe('BulkAddSlotsModal close guards (BUG-4)', () => {
  it('ESC closes the modal when no POST is in flight', async () => {
    const { onClose } = renderModal()
    // Sanity check — header should be rendered.
    expect(
      screen.getByRole('heading', { name: 'Добавить слоты' }),
    ).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('backdrop click closes the modal when no POST is in flight', async () => {
    const { onClose } = renderModal()
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(dialog)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('ESC is blocked while a preview POST is in flight', async () => {
    const { onClose } = renderModal()
    // Trigger the preview path — POST will hang per our fetch stub,
    // so `previewing` stays true until the test ends.
    const previewBtn = await screen.findByRole('button', {
      name: /предпросмотр/i,
    })
    fireEvent.click(previewBtn)
    // Give React a microtask to commit `setPreviewing(true)`.
    await waitFor(() => {
      expect(previewBtn).toBeDisabled()
    })
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('backdrop click is blocked while a preview POST is in flight', async () => {
    const { onClose } = renderModal()
    const previewBtn = await screen.findByRole('button', {
      name: /предпросмотр/i,
    })
    fireEvent.click(previewBtn)
    await waitFor(() => {
      expect(previewBtn).toBeDisabled()
    })
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(dialog)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('× button is disabled while a preview POST is in flight', async () => {
    renderModal()
    const previewBtn = await screen.findByRole('button', {
      name: /предпросмотр/i,
    })
    fireEvent.click(previewBtn)
    const closeBtn = await screen.findByRole('button', { name: 'Закрыть' })
    await waitFor(() => {
      expect(closeBtn).toBeDisabled()
    })
  })
})
