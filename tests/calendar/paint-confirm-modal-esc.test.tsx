// @vitest-environment jsdom

// 2026-06-14 teacher-calendar-mouse-fix BUG-3b — PaintConfirmModal
// must close on ESC (when no POST is in flight). Before this fix the
// modal only closed via backdrop click + the «Отмена» button; ESC was
// inconsistent with the other calendar modals.

import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { PaintConfirmModal } from '@/components/calendar/PaintConfirmModal'
import type { PaintSpan } from '@/lib/calendar/drag-state'

const SPAN: PaintSpan = {
  ymd: '2026-05-18',
  fromHalfHour: 0,
  toHalfHour: 2,
}

describe('PaintConfirmModal ESC handler (BUG-3b)', () => {
  it('ESC closes the modal', () => {
    const onCancel = vi.fn()
    const onConfirm = vi.fn(async () => {})
    render(
      <PaintConfirmModal
        span={SPAN}
        tariffs={[]}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('ESC is a no-op for non-Escape keys', () => {
    const onCancel = vi.fn()
    const onConfirm = vi.fn(async () => {})
    render(
      <PaintConfirmModal
        span={SPAN}
        tariffs={[]}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    )
    fireEvent.keyDown(document, { key: 'Enter' })
    fireEvent.keyDown(document, { key: 'a' })
    expect(onCancel).not.toHaveBeenCalled()
  })
})
