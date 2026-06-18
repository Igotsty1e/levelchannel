// @vitest-environment jsdom

// A.1 tariff reprice (2026-06-18) — pick-a-tier surface visual contract.
//
// Pins after reprice:
//   - Empty state (active === null) renders exactly TWO tier cards:
//     «Стартовый» (free) и «Оптимальный» (mid). Pro depublish.
//   - free card has a chip (NOT a button); mid has «Подписаться» button.
//   - The «Оптимальный» card carries a "Популярный" badge (теперь это
//     единственный платный публичный тариф, badge переехал с Pro на Mid).
//   - Каждая карточка рендерит feature-bullets из каталога.
//   - Цены: free «Бесплатно», mid «399 ₽ / 30 дней».
//   - Free показывает «До 3 активных учеников»; mid — «Без ограничения
//     по числу учеников» (learnerLimit=0 в client.tsx означает unlimited).

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { TeacherSubscriptionClient } from '@/app/teacher/subscription/client'

const TARIFFS = [
  {
    tier: 'free' as const,
    titleRu: 'Стартовый',
    amountKopecks: 0,
    learnerLimit: 3,
    description: 'desc-free',
    features: ['До 3 активных учеников', 'Все функции платформы', 'Расписание, слоты, дела'],
  },
  {
    tier: 'mid' as const,
    titleRu: 'Оптимальный',
    amountKopecks: 39900,
    learnerLimit: 0, // page.tsx маппит null → 0 для unlimited
    description: 'desc-mid',
    features: ['Всё из «Стартового»', 'Без лимита учеников', 'Расширенная аналитика'],
  },
]

describe('TeacherSubscriptionClient — pick-a-tier (A.1 reprice 2026-06-18)', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders exactly TWO tier cards in the empty state (Стартовый + Оптимальный)', () => {
    render(<TeacherSubscriptionClient active={null} tariffs={TARIFFS} />)
    expect(screen.getByTestId('teacher-subscription-tier-free')).toBeTruthy()
    expect(screen.getByTestId('teacher-subscription-tier-mid')).toBeTruthy()
    expect(screen.queryByTestId('teacher-subscription-tier-pro')).toBeNull()
    expect(screen.getAllByText('Стартовый').length).toBe(1)
    expect(screen.getAllByText('Оптимальный').length).toBe(1)
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

  it('the Оптимальный card carries a "Популярный" badge', () => {
    render(<TeacherSubscriptionClient active={null} tariffs={TARIFFS} />)
    const midBadge = screen.queryByTestId('teacher-subscription-tier-mid-badge')
    expect(midBadge).not.toBeNull()
    expect(midBadge?.textContent).toContain('Популярный')
  })

  it('each card renders the feature-bullets from the catalogue', () => {
    render(<TeacherSubscriptionClient active={null} tariffs={TARIFFS} />)
    const midFeatures = screen.getByTestId('teacher-subscription-tier-mid-features')
    expect(midFeatures.textContent).toContain('Без лимита учеников')
    const freeFeatures = screen.getByTestId('teacher-subscription-tier-free-features')
    expect(freeFeatures.textContent).toContain('Все функции платформы')
  })

  it('mid card has a Подписаться button (initially disabled until CP widget loads)', () => {
    render(<TeacherSubscriptionClient active={null} tariffs={TARIFFS} />)
    const midBtn = screen.getByTestId(
      'teacher-subscription-subscribe-mid',
    ) as HTMLButtonElement
    expect(midBtn.textContent).toContain('Подписаться')
    expect(midBtn.disabled).toBe(true)
  })

  it('formats price as 399 ₽ with 30-day period label', () => {
    render(<TeacherSubscriptionClient active={null} tariffs={TARIFFS} />)
    const midCard = screen.getByTestId('teacher-subscription-tier-mid')
    expect(midCard.textContent).toContain('399 ₽')
    expect(midCard.textContent).toContain('30 дней')
  })

  it('free card shows "До 3 активных учеников"', () => {
    render(<TeacherSubscriptionClient active={null} tariffs={TARIFFS} />)
    const freeCard = screen.getByTestId('teacher-subscription-tier-free')
    expect(freeCard.textContent).toContain('До 3 активных учеников')
  })

  it('mid card with learnerLimit=0 shows "Без ограничения по числу учеников"', () => {
    render(<TeacherSubscriptionClient active={null} tariffs={TARIFFS} />)
    const midCard = screen.getByTestId('teacher-subscription-tier-mid')
    expect(midCard.textContent).toContain('Без ограничения по числу учеников')
    expect(midCard.textContent).not.toContain('До 0 активных')
  })
})
