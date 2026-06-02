// @vitest-environment jsdom

// Plan: docs/plans/bug-1-payment-method-banner.md §Tests Test 1.
// Render test pinning the missing-payment-method banner copy + the
// «занятие» / no-«слот» style-guide constraint
// (docs/content-style.md:116).

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { MissingPaymentMethodBanner } from '@/components/cabinet/missing-payment-method-banner'

describe('MissingPaymentMethodBanner', () => {
  it('variant=single + canBuyPackages=false renders only the primary line', () => {
    render(
      <MissingPaymentMethodBanner variant="single" canBuyPackages={false} />,
    )
    const node = screen.getByTestId('missing-payment-method-banner')
    expect(node.getAttribute('role')).toBe('status')
    expect(node.getAttribute('data-variant')).toBe('single')
    expect(node.textContent).toContain(
      'Вы пока не можете забронировать занятие. Учитель должен выбрать модель оплаты за занятия.',
    )
    expect(node.textContent ?? '').not.toContain('Не нужно ничего покупать')
  })

  it('variant=single + canBuyPackages=true renders the second-paragraph hint', () => {
    render(
      <MissingPaymentMethodBanner variant="single" canBuyPackages={true} />,
    )
    const node = screen.getByTestId('missing-payment-method-banner')
    expect(node.textContent).toContain(
      'Вы пока не можете забронировать занятие.',
    )
    expect(node.textContent).toContain(
      'Не нужно ничего покупать заранее — сначала дождитесь, пока учитель выберет способ оплаты.',
    )
  })

  it('variant=per-teacher uses the «у этого учителя» phrasing', () => {
    render(
      <MissingPaymentMethodBanner
        variant="per-teacher"
        canBuyPackages={false}
      />,
    )
    const node = screen.getByTestId('missing-payment-method-banner')
    expect(node.getAttribute('data-variant')).toBe('per-teacher')
    expect(node.textContent).toContain(
      'Вы пока не можете забронировать занятие у этого учителя. Учитель должен выбрать модель оплаты за занятия.',
    )
  })

  it('uses «занятие», never «слот» (style-guide pin, docs/content-style.md:116)', () => {
    // Cover both variants in one negative pin.
    const { container: singleContainer } = render(
      <MissingPaymentMethodBanner variant="single" canBuyPackages={true} />,
    )
    expect(singleContainer.textContent ?? '').not.toMatch(/слот/i)

    const { container: perTeacherContainer } = render(
      <MissingPaymentMethodBanner
        variant="per-teacher"
        canBuyPackages={true}
      />,
    )
    expect(perTeacherContainer.textContent ?? '').not.toMatch(/слот/i)
  })
})
