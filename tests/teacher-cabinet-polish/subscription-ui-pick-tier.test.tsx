// @vitest-environment jsdom

// bug-4 Sub-PR B (2026-06-02) — pick-a-tier surface visual contract.
// free-tier-saas-card-and-subscription-row plan §0a-7 (2026-06-05) —
// Стартовый (free) card now also rendered in pick-tier mode with a
// «Доступен по умолчанию» chip in place of «Подписаться» button.
//
// Pins:
//   - Empty state (active === null) renders exactly THREE tier cards:
//     «Стартовый» (free), «Базовый» (mid), «Расширенный» (pro).
//   - free card has a chip (NOT a button); mid/pro have «Подписаться» buttons.
//   - The «Расширенный» card carries a "Популярный" badge; the other two don't.
//   - Each card renders the feature-bullets from the catalogue.
//   - Prices come from `tariffs[*].amountKopecks`; free renders «Бесплатно».

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { TeacherSubscriptionClient } from '@/app/teacher/subscription/client'

const TARIFFS = [
  {
    tier: 'free' as const,
    titleRu: 'Стартовый',
    amountKopecks: 0,
    learnerLimit: 1,
    description: 'desc-free',
    features: ['До 1 активного ученика', 'Расписание и слоты', '1 пакет и 1 тариф'],
  },
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

  it('renders exactly THREE tier cards in the empty state (Стартовый + Базовый + Расширенный)', () => {
    render(<TeacherSubscriptionClient active={null} tariffs={TARIFFS} />)
    expect(screen.getByTestId('teacher-subscription-tier-free')).toBeTruthy()
    expect(screen.getByTestId('teacher-subscription-tier-mid')).toBeTruthy()
    expect(screen.getByTestId('teacher-subscription-tier-pro')).toBeTruthy()
    // All three required titles render exactly once.
    expect(screen.getAllByText('Стартовый').length).toBe(1)
    expect(screen.getAllByText('Базовый').length).toBe(1)
    expect(screen.getAllByText('Расширенный').length).toBe(1)
  })

  it('the Стартовый card has «Доступен по умолчанию» chip (NOT a Подписаться button)', () => {
    render(<TeacherSubscriptionClient active={null} tariffs={TARIFFS} />)
    const chip = screen.getByTestId('teacher-subscription-tier-free-chip')
    expect(chip.textContent).toContain('Доступен по умолчанию')
    expect(screen.queryByTestId('teacher-subscription-subscribe-free')).toBeNull()
  })

  it('the Стартовый card price reads «Бесплатно» (no 30-day period label)', () => {
    render(<TeacherSubscriptionClient active={null} tariffs={TARIFFS} />)
    const freeCard = screen.getByTestId('teacher-subscription-tier-free')
    expect(freeCard.textContent).toContain('Бесплатно')
    expect(freeCard.textContent).not.toContain('30 дней')
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
