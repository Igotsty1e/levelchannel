// @vitest-environment jsdom

// bug-4 Sub-PR B (2026-06-02) — pick-a-tier surface visual contract.
//
// Pins:
//   - Empty state (active === null) renders exactly two tier cards:
//     «Базовый» (mid) and «Расширенный» (pro). «Стартовый» is NOT
//     a purchasable tier on /teacher/subscription.
//   - Each card shows a "Подписаться" button.
//   - The «Расширенный» card carries a "Популярный" badge; «Базовый» does not.
//   - Each card renders the feature-bullets from the catalogue.
//   - Prices come from `tariffs[*].amountKopecks` formatted as roubles.

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { TeacherSubscriptionClient } from '@/app/teacher/subscription/client'

const TARIFFS = [
  {
    tier: 'mid' as const,
    titleRu: 'Базовый',
    amountKopecks: 30000,
    learnerLimit: 5,
    description: 'desc-mid',
    features: ['Расписание и слоты', 'До 5 активных учеников', 'Пакеты'],
  },
  {
    tier: 'pro' as const,
    titleRu: 'Расширенный',
    amountKopecks: 80000,
    learnerLimit: 30,
    description: 'desc-pro',
    features: ['Всё из «Базового»', 'До 30 активных учеников', 'Расширенные отчёты'],
  },
]

describe('TeacherSubscriptionClient — pick-a-tier (bug-4 Sub-PR B)', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders exactly two tier cards in the empty state (Стартовый is NOT shown)', () => {
    render(<TeacherSubscriptionClient active={null} tariffs={TARIFFS} />)
    expect(screen.getByTestId('teacher-subscription-tier-mid')).toBeTruthy()
    expect(screen.getByTestId('teacher-subscription-tier-pro')).toBeTruthy()
    // Negative pin — there's no «Стартовый» / `free` card here.
    expect(screen.queryByText('Стартовый')).toBeNull()
    // Both required titles render exactly once.
    expect(screen.getAllByText('Базовый').length).toBe(1)
    expect(screen.getAllByText('Расширенный').length).toBe(1)
  })

  it('the Расширенный card carries a "Популярный" badge; Базовый does not', () => {
    render(<TeacherSubscriptionClient active={null} tariffs={TARIFFS} />)
    const proBadge = screen.queryByTestId('teacher-subscription-tier-pro-badge')
    expect(proBadge).not.toBeNull()
    expect(proBadge?.textContent).toContain('Популярный')
    const midBadge = screen.queryByTestId('teacher-subscription-tier-mid-badge')
    expect(midBadge).toBeNull()
  })

  it('each card renders the feature-bullets from the catalogue', () => {
    render(<TeacherSubscriptionClient active={null} tariffs={TARIFFS} />)
    const midFeatures = screen.getByTestId('teacher-subscription-tier-mid-features')
    expect(midFeatures.textContent).toContain('Расписание и слоты')
    expect(midFeatures.textContent).toContain('До 5 активных учеников')
    const proFeatures = screen.getByTestId('teacher-subscription-tier-pro-features')
    expect(proFeatures.textContent).toContain('Всё из «Базового»')
    expect(proFeatures.textContent).toContain('До 30 активных учеников')
  })

  it('each card has a Подписаться button (initially disabled until CP widget loads)', () => {
    render(<TeacherSubscriptionClient active={null} tariffs={TARIFFS} />)
    const midBtn = screen.getByTestId(
      'teacher-subscription-subscribe-mid',
    ) as HTMLButtonElement
    const proBtn = screen.getByTestId(
      'teacher-subscription-subscribe-pro',
    ) as HTMLButtonElement
    expect(midBtn.textContent).toContain('Подписаться')
    expect(proBtn.textContent).toContain('Подписаться')
    // CloudPayments widget script hasn't loaded in jsdom — both should
    // be disabled by the `!scriptReady` guard.
    expect(midBtn.disabled).toBe(true)
    expect(proBtn.disabled).toBe(true)
  })

  it('formats prices as roubles with 30-day period label', () => {
    render(<TeacherSubscriptionClient active={null} tariffs={TARIFFS} />)
    const midCard = screen.getByTestId('teacher-subscription-tier-mid')
    expect(midCard.textContent).toContain('300 ₽')
    expect(midCard.textContent).toContain('30 дней')
    const proCard = screen.getByTestId('teacher-subscription-tier-pro')
    expect(proCard.textContent).toContain('800 ₽')
    expect(proCard.textContent).toContain('30 дней')
  })
})
