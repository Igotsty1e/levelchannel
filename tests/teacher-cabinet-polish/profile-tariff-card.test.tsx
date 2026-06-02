// @vitest-environment jsdom

// Teacher cabinet polish — Sub-PR C (TASK-2).
// Plan: docs/plans/teacher-cabinet-polish.md §3 Sub-PR C.
//
// Pins the load-bearing claims for <TariffComparisonCard />:
//   - All 4 plan cards render (free / mid / pro / operator-managed).
//   - With currentPlanSlug='free'              → only the Free card carries the badge.
//   - With currentPlanSlug='mid'               → only the Mid card carries the badge.
//   - With currentPlanSlug='pro'               → only the Pro card carries the badge.
//   - With currentPlanSlug='operator-managed'  → only the Operator-managed card carries the badge.
//   - All 4 "Сменить тариф" buttons are disabled AND carry the
//     hover-title hint per Q-4 closure (plain HTML title attribute).
//   - Each card formats price and learner-limit per the helpers
//     (kopecks → roubles; NULL learner_limit → "Без ограничений").
//
// Test location matches Sub-PR A/B's pattern: lives under
// `tests/teacher-cabinet-polish/` (NOT `tests/integration/...`) so the
// unit runner's jsdom + setup-rtl.ts pick it up. The integration
// runner is node-env + *.test.ts only and would skip a *.tsx file.

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import {
  TariffComparisonCard,
  type TariffComparisonPlan,
} from '@/components/teacher/tariff-comparison-card'

// bug-4 Sub-PR A (2026-06-02): Russian public titles per mig 0103.
// Slugs unchanged; only the rendered titleRu flipped.
const PLANS: TariffComparisonPlan[] = [
  {
    slug: 'free',
    titleRu: 'Стартовый',
    priceKopecksMonthly: 0,
    learnerLimit: 1,
    features: {},
  },
  {
    slug: 'mid',
    titleRu: 'Базовый',
    priceKopecksMonthly: 30000,
    learnerLimit: 5,
    features: {},
  },
  {
    slug: 'pro',
    titleRu: 'Расширенный',
    priceKopecksMonthly: 80000,
    learnerLimit: 30,
    features: {},
  },
  {
    slug: 'operator-managed',
    titleRu: 'Operator-managed',
    priceKopecksMonthly: 0,
    learnerLimit: null,
    features: { money_flow_through_platform: true },
  },
]

const ALL_SLUGS = ['free', 'mid', 'pro', 'operator-managed'] as const

function assertOnlyBadgeOn(currentSlug: string) {
  for (const slug of ALL_SLUGS) {
    const badge = screen.queryByTestId(`tariff-card-${slug}-current-badge`)
    const card = screen.getByTestId(`tariff-card-${slug}`)
    if (slug === currentSlug) {
      expect(badge).not.toBeNull()
      expect(badge?.textContent).toContain('Текущий тариф')
      expect(card.getAttribute('data-current')).toBe('true')
    } else {
      expect(badge).toBeNull()
      expect(card.getAttribute('data-current')).toBe('false')
    }
  }
}

function assertAllSwitchButtonsDisabled() {
  for (const slug of ALL_SLUGS) {
    const button = screen.getByTestId(
      `tariff-card-${slug}-switch-button`,
    ) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(button.getAttribute('title')).toBe(
      'Скоро / Свяжитесь с оператором',
    )
    expect(button.textContent).toContain('Сменить тариф')
  }
}

describe('TariffComparisonCard — TASK-2 profile tariff card', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders all 4 plan cards', () => {
    render(<TariffComparisonCard plans={PLANS} currentPlanSlug="free" />)
    for (const slug of ALL_SLUGS) {
      const card = screen.getByTestId(`tariff-card-${slug}`)
      // `getByTestId` throws on miss, so reaching here proves the
      // element exists; assert truthiness defensively. Avoid the
      // jest-dom `toBeInTheDocument` matcher to stay typecheck-clean
      // without a global type-augmentation file in this repo.
      expect(card).toBeTruthy()
    }
  })

  it('currentPlanSlug=free → only Free card has the current-plan badge', () => {
    render(<TariffComparisonCard plans={PLANS} currentPlanSlug="free" />)
    assertOnlyBadgeOn('free')
  })

  it('currentPlanSlug=mid → only Mid card has the current-plan badge', () => {
    render(<TariffComparisonCard plans={PLANS} currentPlanSlug="mid" />)
    assertOnlyBadgeOn('mid')
  })

  it('currentPlanSlug=pro → only Pro card has the current-plan badge', () => {
    render(<TariffComparisonCard plans={PLANS} currentPlanSlug="pro" />)
    assertOnlyBadgeOn('pro')
  })

  it('currentPlanSlug=operator-managed → only Operator card has the badge', () => {
    render(
      <TariffComparisonCard
        plans={PLANS}
        currentPlanSlug="operator-managed"
      />,
    )
    assertOnlyBadgeOn('operator-managed')
  })

  it('all 4 "Сменить тариф" buttons are disabled and carry the hover title', () => {
    render(<TariffComparisonCard plans={PLANS} currentPlanSlug="free" />)
    assertAllSwitchButtonsDisabled()
  })

  it('formats price: zero → "Бесплатно"; non-zero → "{N}₽/мес"', () => {
    render(<TariffComparisonCard plans={PLANS} currentPlanSlug="free" />)
    const free = screen.getByTestId('tariff-card-free')
    expect(free.textContent).toContain('Бесплатно')
    const mid = screen.getByTestId('tariff-card-mid')
    expect(mid.textContent).toContain('300₽/мес')
    const pro = screen.getByTestId('tariff-card-pro')
    expect(pro.textContent).toContain('800₽/мес')
    const op = screen.getByTestId('tariff-card-operator-managed')
    expect(op.textContent).toContain('Бесплатно')
  })

  it('formats learner_limit: NULL → "Без ограничений"; N → "До N ученик{а|ов}"', () => {
    render(<TariffComparisonCard plans={PLANS} currentPlanSlug="free" />)
    expect(screen.getByTestId('tariff-card-free').textContent).toContain(
      'До 1 ученика',
    )
    expect(screen.getByTestId('tariff-card-mid').textContent).toContain(
      'До 5 учеников',
    )
    expect(screen.getByTestId('tariff-card-pro').textContent).toContain(
      'До 30 учеников',
    )
    expect(
      screen.getByTestId('tariff-card-operator-managed').textContent,
    ).toContain('Без ограничений')
  })

  it('renders known feature flags from jsonb when present', () => {
    render(<TariffComparisonCard plans={PLANS} currentPlanSlug="free" />)
    expect(
      screen.getByTestId('tariff-card-operator-managed').textContent,
    ).toContain('Платежи через платформу')
    // The Free / Mid / Pro rows have an empty features blob; no
    // feature lines should leak.
    expect(screen.getByTestId('tariff-card-free').textContent).not.toContain(
      'Платежи через платформу',
    )
  })

  it('cards render in canonical order: free → mid → pro → operator-managed', () => {
    render(<TariffComparisonCard plans={PLANS} currentPlanSlug="free" />)
    // Match BARE card test-ids ONLY — exclude `*-current-badge` and
    // `*-switch-button` (anchored regex against the data-testid).
    const cardSlugs = new Set(['free', 'mid', 'pro', 'operator-managed'])
    const slugs = Array.from(
      document.querySelectorAll<HTMLElement>('[data-testid]'),
    )
      .map((el) => el.dataset.testid ?? '')
      .filter((id) => {
        const m = /^tariff-card-([a-z-]+)$/.exec(id)
        return m !== null && cardSlugs.has(m[1])
      })
    expect(slugs).toEqual([
      'tariff-card-free',
      'tariff-card-mid',
      'tariff-card-pro',
      'tariff-card-operator-managed',
    ])
  })

  it('subheading names the current plan', () => {
    render(<TariffComparisonCard plans={PLANS} currentPlanSlug="mid" />)
    const root = screen.getByTestId('tariff-comparison-card')
    expect(root.textContent).toContain('Сейчас вы на тарифе')
    expect(root.textContent).toContain('Базовый')
  })
})
