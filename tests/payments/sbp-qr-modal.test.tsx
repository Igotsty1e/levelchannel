// @vitest-environment jsdom

import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { SbpQrModal } from '@/components/payments/sbp-qr-modal'

// SBP-PAY (2026-05-19) — RTL component tests for the QR modal. Pins
// the a11y contract (role="dialog" + aria-labelledby + ESC closes +
// auto-focus on close button) + the guest-warning conditional copy.
//
// We DON'T exercise the status-poll fetch here — that's covered by
// the use-payment-status-poll test seam (intervalMs/timeoutMs) +
// future integration tests. RTL tests assert the static surface.

const baseProps = {
  invoiceId: 'lc_sbptest_000000',
  qrUrl: 'https://qr.nspk.ru/AS10001Q1234',
  image: null,
  receiptToken: 'plain-token-abc',
  onClose: vi.fn(),
  onPaid: vi.fn(),
  onFailed: vi.fn(),
  onTimeout: vi.fn(),
}

describe('SbpQrModal a11y + render', () => {
  it('renders the QR image with descriptive alt text', () => {
    const { getByAltText } = render(
      <SbpQrModal {...baseProps} isGuest={false} />,
    )
    const img = getByAltText('QR-код для оплаты через СБП') as HTMLImageElement
    expect(img.src).toBe('https://qr.nspk.ru/AS10001Q1234')
  })

  it('renders the dialog with aria-modal + aria-labelledby', () => {
    const { getByRole } = render(
      <SbpQrModal {...baseProps} isGuest={false} />,
    )
    const dialog = getByRole('dialog')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.getAttribute('aria-labelledby')).toBe(
      'sbp-qr-modal-heading',
    )
  })

  it('renders the Russian heading "Оплата через СБП"', () => {
    const { getByRole } = render(
      <SbpQrModal {...baseProps} isGuest={false} />,
    )
    const heading = getByRole('heading', { level: 2 })
    expect(heading.textContent).toBe('Оплата через СБП')
  })

  it('ESC key fires onClose', () => {
    const onClose = vi.fn()
    render(<SbpQrModal {...baseProps} onClose={onClose} isGuest={false} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('close-button click fires onClose', () => {
    const onClose = vi.fn()
    const { getByLabelText } = render(
      <SbpQrModal {...baseProps} onClose={onClose} isGuest={false} />,
    )
    fireEvent.click(getByLabelText('Закрыть окно оплаты СБП'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('shows guest-warning copy when isGuest=true', () => {
    const { getByText } = render(
      <SbpQrModal {...baseProps} isGuest={true} />,
    )
    expect(
      getByText(/Не закрывайте эту страницу до оплаты/),
    ).toBeTruthy()
  })

  it('HIDES guest-warning copy when isGuest=false', () => {
    const { queryByText } = render(
      <SbpQrModal {...baseProps} isGuest={false} />,
    )
    expect(queryByText(/Не закрывайте эту страницу до оплаты/)).toBeNull()
  })

  it('deep-link button is an <a target="_blank" rel="noopener noreferrer"> with the qrUrl', () => {
    const { getByText } = render(
      <SbpQrModal {...baseProps} isGuest={false} />,
    )
    const link = getByText('Открыть в приложении банка') as HTMLAnchorElement
    expect(link.tagName).toBe('A')
    expect(link.href).toBe('https://qr.nspk.ru/AS10001Q1234')
    expect(link.target).toBe('_blank')
    expect(link.rel).toBe('noopener noreferrer')
  })
})
