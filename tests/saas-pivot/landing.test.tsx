// @vitest-environment jsdom

// SAAS-PIVOT Epic 8 Day 7 (2026-05-22) — teacher-acquisition landing tests.
//
// Plan: docs/plans/saas-pivot-master.md §3 Epic 8 + §5 Day 7.
//
// Why this lives under `tests/` (unit runner) and NOT under
// `tests/integration/saas-pivot/` despite the plan-doc wording: the
// landing page is presentational, holds no DB state, and renders fully
// on the client once `TeacherLandingClient` mounts. The integration
// runner (`vitest.integration.config.ts`) is scoped to Docker Postgres
// suites and only matches `*.test.ts` — RTL setup (`tests/setup-rtl.ts`)
// is wired into the unit config. Putting this under `tests/saas-pivot/`
// gives us the RTL toolchain for free and keeps the integration runner
// focused on real database work.
//
// What this pins:
//   1. The page renders without throwing (server-component `SaasPage`
//      logs the `landing_view` line and returns the client island).
//   2. The hero copy is teacher-targeted (value prop language).
//   3. A `/register?role=teacher` deep-link is present.
//   4. The pricing block surfaces all four tiers with the correct CTA
//      semantics (Free CTA links to teacher-register; Mid is "Скоро";
//      Pro has the mailto CTA; Operator-managed deferred per plan-doc §8).
//   5. The `/pay` legacy link is preserved in the footer (the route is
//      kept per plan §3 Epic 8 — plan-4 learner-payment surface).
//   6. Headings respect h1 → h2 → h3 hierarchy.

import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

// Mocks so the page module loads cleanly in jsdom without Next.js
// server runtime context. `next/link` is replaced with a plain <a> so
// the rendered DOM exposes `href` directly to `screen.getByRole(...)`.
vi.mock('next/link', () => {
  return {
    default: ({ href, children, ...rest }: any) => (
      <a href={typeof href === 'string' ? href : String(href)} {...rest}>
        {children}
      </a>
    ),
  }
})

import SaasPage from '@/app/saas/page'

describe('SAAS-PIVOT Epic 8 — teacher-acquisition landing (/saas)', () => {
  it('renders the teacher-targeted value prop in the hero', () => {
    render(SaasPage())
    // h1 carries the value prop. Two-line clause split across spans —
    // the visible accessible name concatenates them.
    const h1 = screen.getByRole('heading', { level: 1 })
    expect(h1.textContent ?? '').toMatch(/Расписание, ученики и балансы/i)
    expect(h1.textContent ?? '').toMatch(/в одном кабинете/i)
  })

  it('deep-links to /register?role=teacher from the primary CTAs', () => {
    const { container } = render(SaasPage())
    // At least one CTA must be the teacher-register deep-link. The
    // hero, header, "how it works", final-CTA, and the Free pricing
    // tier all share this destination.
    const teacherRegisterLinks = Array.from(
      container.querySelectorAll('a[href="/register?role=teacher"]'),
    )
    expect(teacherRegisterLinks.length).toBeGreaterThanOrEqual(3)
  })

  it('preserves the /pay legacy learner-payment route in the footer', () => {
    const { container } = render(SaasPage())
    const payLink = container.querySelector('a[href="/pay"]')
    expect(payLink).not.toBeNull()
    expect(payLink?.textContent ?? '').toMatch(/Перейти к оплате/i)
  })

  it('shows the three pricing tiers with plan-correct CTA semantics', () => {
    // A2 (2026-05-30) — Mid/Pro CTAs activated: both route to
    // /teacher/subscription (через /teacher/layout.tsx гейт, гость
    // получит /login). «Скоро» buttons и Pro mailto early-access ушли.
    const { container } = render(SaasPage())
    // Tier names appear as h3 inside the pricing section.
    expect(screen.getByText('Free')).toBeTruthy()
    expect(screen.getByText('Mid')).toBeTruthy()
    expect(screen.getByText('Pro')).toBeTruthy()
    // Negative pin — Operator-managed tier must NOT reappear here.
    expect(screen.queryByText('Платежи через платформу')).toBeNull()

    // Both Mid and Pro now route to /teacher/subscription as primary CTAs.
    const subscriptionLinks = Array.from(
      container.querySelectorAll('a[href="/teacher/subscription"]'),
    )
    expect(subscriptionLinks.length).toBeGreaterThanOrEqual(2)
    // «Подписаться» label is present on both Mid and Pro tier CTAs.
    const subscribeButtons = subscriptionLinks.filter(
      (a) => (a.textContent ?? '').trim() === 'Подписаться',
    )
    expect(subscribeButtons.length).toBeGreaterThanOrEqual(2)
    // No more disabled "Скоро" CTA in the pricing tiers.
    const skoroButtons = Array.from(
      container.querySelectorAll('button[disabled]'),
    ).filter((b) => (b.textContent ?? '').trim() === 'Скоро')
    expect(skoroButtons.length).toBe(0)
  })

  it('respects heading hierarchy (one h1 at the hero; h2 per section; h3 sub-headings)', () => {
    render(SaasPage())
    const h1s = screen.getAllByRole('heading', { level: 1 })
    expect(h1s.length).toBe(1)
    const h2s = screen.getAllByRole('heading', { level: 2 })
    // Problem + How-it-works + Features + Pricing + SocialProof +
    // Comparison + FinalCTA = 7 sections each with an h2.
    expect(h2s.length).toBeGreaterThanOrEqual(6)
    const h3s = screen.getAllByRole('heading', { level: 3 })
    // Pain cards (4) + feature cards (6) + 4 pricing tiers + social-
    // proof claims (4) + footer headings — definitely > 10.
    expect(h3s.length).toBeGreaterThanOrEqual(10)
  })

  it('mentions the Free tier as the entry CTA copy', () => {
    render(SaasPage())
    // Several CTAs share the "Начать бесплатно" / "Создать кабинет
    // бесплатно" copy — at least one must surface.
    const freeCtas = screen.getAllByText(/Начать бесплатно|Создать кабинет бесплатно?/i)
    expect(freeCtas.length).toBeGreaterThanOrEqual(1)
  })

  it('renders the comparison block with the research-§5.8 categories', () => {
    const { container } = render(SaasPage())
    // Pin the comparison categories the research doc spelled out. Each
    // appears inside an <h2>-titled "Чем мы отличаемся" section, so we
    // assert the rows under #comparison only — "Excel" leaks into the
    // hero copy too, which `getByText` would flag as ambiguous.
    const section = container.querySelector('#comparison')
    expect(section).not.toBeNull()
    const sectionText = section?.textContent ?? ''
    expect(sectionText).toMatch(/Excel/)
    expect(sectionText).toMatch(/Telegram/)
    expect(sectionText).toMatch(/Google Calendar/)
  })

  it('emits the server-side landing_view log line', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    SaasPage()
    const fired = spy.mock.calls.some(
      (args) =>
        typeof args[0] === 'string' &&
        args[0].includes('[landing] view') &&
        args[1] &&
        typeof args[1] === 'object' &&
        (args[1] as Record<string, unknown>).page === '/saas',
    )
    expect(fired).toBe(true)
    spy.mockRestore()
  })

  it('keeps the footer hint that this landing is teacher-targeted', () => {
    render(SaasPage())
    // Plan §3 Epic 8 + owner decision 2026-05-21 "только для учителей":
    // we need to make clear to a wandering learner that this isn't the
    // page they're looking for, and point them to /pay.
    const hint = screen.getByText(/Этот лендинг — для преподавателей/i)
    expect(hint).toBeTruthy()
    const block = hint.closest('div')
    if (block) {
      const payLink = within(block).getByText(/Перейти к оплате/i)
      expect(payLink).toBeTruthy()
    }
  })
})
