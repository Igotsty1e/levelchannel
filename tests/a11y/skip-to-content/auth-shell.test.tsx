// @vitest-environment jsdom

// SAAS-6-A11Y-1 (2026-05-19) — skip-to-content link on <AuthShell>.
// WCAG 2.4.1 Bypass Blocks (Level A). RTL + jsdom toolchain via
// SAAS-INFRA-1 (see tests/setup-rtl.ts).
//
// The test pins the *DOM shape* — link is the first child, has the
// expected class + href, points at an `id="main-content"` <main>.
// jsdom does not compute CSS (see saas-infra-1 plan R4), so visual
// "hidden until focused" is verified manually + via the .skip-to-content
// CSS rule shipped in app/globals.css. The DOM-level guarantee here
// is: (a) link exists, (b) href points to #main-content, (c) target
// element exists with the right id.

import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { AuthShell } from '@/components/auth-shell'

// SiteHeader is a client-island that calls fetch on mount; in jsdom we
// don't need to exercise that path for the skip-link contract, but a
// no-op fetch keeps the smoke clean (no unhandled rejection).
vi.stubGlobal(
  'fetch',
  vi.fn(() =>
    Promise.resolve({ ok: false, json: () => Promise.resolve(null) } as Response),
  ),
)

describe('AuthShell — skip-to-content link (SAAS-6-A11Y-1)', () => {
  it('renders the skip link as the first focusable element with href="#main-content"', () => {
    const { container } = render(
      <AuthShell>
        <div data-testid="child">child</div>
      </AuthShell>,
    )

    // First child of the rendered fragment must be the skip link.
    const firstChild = container.firstElementChild
    expect(firstChild).not.toBeNull()
    expect(firstChild?.tagName).toBe('A')
    expect(firstChild?.getAttribute('href')).toBe('#main-content')
    expect(firstChild?.className).toContain('skip-to-content')
  })

  it('uses the Russian-language copy required by docs/content-style.md', () => {
    const { container } = render(
      <AuthShell>
        <div>child</div>
      </AuthShell>,
    )
    const link = container.querySelector('a.skip-to-content')
    expect(link).not.toBeNull()
    expect(link?.textContent?.trim()).toBe('Перейти к основному содержимому')
  })

  it('renders <main id="main-content"> with tabIndex=-1 as the skip target', () => {
    const { container } = render(
      <AuthShell>
        <div>child</div>
      </AuthShell>,
    )
    const main = container.querySelector('main#main-content')
    expect(main).not.toBeNull()
    expect(main?.getAttribute('tabindex')).toBe('-1')
  })
})
