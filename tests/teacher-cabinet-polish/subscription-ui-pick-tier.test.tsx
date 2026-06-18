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

  // A.2 annual tariff (2026-06-18) — toggle Месяц / Год + annual carCard rendering.
  it('renders Месяц / Год toggle (default Месяц)', () => {
    render(<TeacherSubscriptionClient active={null} tariffs={TARIFFS} />)
    const toggle = screen.getByTestId('teacher-subscription-cycle-toggle')
    expect(toggle).toBeTruthy()
    const monthly = screen.getByTestId('teacher-subscription-cycle-monthly')
    const annual = screen.getByTestId('teacher-subscription-cycle-annual')
    expect(monthly.getAttribute('aria-checked')).toBe('true')
    expect(annual.getAttribute('aria-checked')).toBe('false')
    expect(annual.textContent).toContain('−15%')
  })

  it('default monthly: mid card shows 399 ₽ / 30 дней, no annual save badge', () => {
    render(<TeacherSubscriptionClient active={null} tariffs={TARIFFS} />)
    const midCard = screen.getByTestId('teacher-subscription-tier-mid')
    expect(midCard.textContent).toContain('399 ₽')
    expect(midCard.textContent).toContain('30 дней')
    expect(
      screen.queryByTestId('teacher-subscription-tier-mid-annual-save'),
    ).toBeNull()
  })

  it('initialBillingCycle="annual": mid card swaps to «Оптимальный на год» 4000 ₽', () => {
    render(
      <TeacherSubscriptionClient
        active={null}
        tariffs={TARIFFS}
        initialBillingCycle="annual"
      />,
    )
    const midCard = screen.getByTestId('teacher-subscription-tier-mid')
    expect(midCard.textContent).toContain('Оптимальный на год')
    expect(midCard.textContent).toContain('4000 ₽')
    expect(midCard.textContent).toContain('/ год')
    const save = screen.getByTestId('teacher-subscription-tier-mid-annual-save')
    // textContent в jsdom может схлопывать пробелы — допускаем оба варианта.
    expect(save.textContent?.replace(/\s/g, '')).toContain('4788₽')
    expect(save.textContent).toContain('экономия 15%')
    const btn = screen.getByTestId('teacher-subscription-subscribe-mid')
    expect(btn.textContent).toContain('Оплатить год')
  })

  it('annual toggle does NOT change Free card (free никогда не annual)', () => {
    render(
      <TeacherSubscriptionClient
        active={null}
        tariffs={TARIFFS}
        initialBillingCycle="annual"
      />,
    )
    const freeCard = screen.getByTestId('teacher-subscription-tier-free')
    expect(freeCard.textContent).toContain('Стартовый')
    expect(freeCard.textContent).toContain('Бесплатно')
    expect(freeCard.textContent).not.toContain('Оптимальный на год')
  })
})
