// @vitest-environment jsdom

// SAAS-6-A11Y-1 (2026-05-19) — skip-to-content link on the marketing
// landing's bespoke shell (no <SiteHeader>). WCAG 2.4.1 Bypass Blocks
// (Level A). The landing page renders <HomePageClient> which carries
// its own <Header> + <main>; the skip link must sit as the first
// focusable element before that <Header>.
//
// jsdom does not implement IntersectionObserver — HomePageClient's
// useScrollAnimation hook handles that absence gracefully (reveals
// all nodes via the fallback branch), so no shim is needed.

import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { HomePageClient } from '@/components/home/home-page-client'

const FIXTURE_LEGAL = {
  legalBankAccount: '40702810000000000000',
  legalBankBik: '044525000',
  legalBankName: 'Тестовый банк',
  legalOperatorDisplay: 'ИП Тестовый Т. Т.',
  legalOperatorTaxId: '770000000000',
  legalOperatorOgrn: '320000000000000',
}

describe('HomePageClient — skip-to-content link (SAAS-6-A11Y-1)', () => {
  it('renders the skip link as the first focusable element with href="#main-content"', () => {
    const { container } = render(<HomePageClient legalProfile={FIXTURE_LEGAL} />)

    // First child of the rendered fragment must be the skip link.
    const firstChild = container.firstElementChild
    expect(firstChild).not.toBeNull()
    expect(firstChild?.tagName).toBe('A')
    expect(firstChild?.getAttribute('href')).toBe('#main-content')
    expect(firstChild?.className).toContain('skip-to-content')
    expect(firstChild?.textContent?.trim()).toBe('Перейти к основному содержимому')
  })

  it('renders <main id="main-content"> as the skip target', () => {
    const { container } = render(<HomePageClient legalProfile={FIXTURE_LEGAL} />)
    const main = container.querySelector('main#main-content')
    expect(main).not.toBeNull()
    expect(main?.getAttribute('tabindex')).toBe('-1')
  })
})
