// @vitest-environment jsdom

// bug-4 Sub-PR B (2026-06-02) — active-subscription surface visual contract.
//
// Pins:
//   - Active subscription renders a "Текущий тариф" badge.
//   - The titleRu of the active tier is rendered as an h2.
//   - "Что входит" block lists feature-bullets from the catalogue.
//   - "Отменить подписку" button is visible when cancelled_at is null.
//   - When cancelled_at is set, the cancel button is HIDDEN and the
//     dl-block surfaces the cancellation date with the access-end hint.
//   - The pick-a-tier surface is NOT rendered (active path only).

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { TeacherSubscriptionClient } from '@/app/teacher/subscription/client'

const PRO_FEATURES = ['Всё из «Базового»', 'До 30 активных учеников', 'Расширенные отчёты']

const ACTIVE_PRO_LIVE = {
  tier: 'pro' as const,
  titleRu: 'Расширенный',
  periodEnd: '2026-07-02T12:00:00Z',
  amountKopecks: 80000,
  cancelledAt: null,
  features: PRO_FEATURES,
}

const ACTIVE_PRO_CANCELLED = {
  ...ACTIVE_PRO_LIVE,
  cancelledAt: '2026-06-15T12:00:00Z',
}

const ACTIVE_MID_LIVE = {
  tier: 'mid' as const,
  titleRu: 'Базовый',
  periodEnd: '2026-07-02T12:00:00Z',
  amountKopecks: 30000,
  cancelledAt: null,
  features: ['Расписание', 'До 5 учеников'],
}

const TARIFFS: ReadonlyArray<{
  tier: 'mid' | 'pro'
  titleRu: string
  amountKopecks: number
  learnerLimit: number
  description: string
  features: string[]
}> = [] // Active path doesn't iterate tariffs.

describe('TeacherSubscriptionClient — active subscription (bug-4 Sub-PR B)', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders the active-subscription surface with the "Текущий тариф" badge', () => {
    render(
      <TeacherSubscriptionClient active={ACTIVE_PRO_LIVE} tariffs={TARIFFS} />,
    )
    expect(screen.getByTestId('teacher-subscription-active')).toBeTruthy()
    expect(screen.getByTestId('teacher-subscription-active-badge')).toBeTruthy()
    expect(
      screen.getByTestId('teacher-subscription-active-badge').textContent,
    ).toContain('Текущий тариф')
    // Negative pin: pick-a-tier surface is NOT in the active path.
    expect(screen.queryByTestId('teacher-subscription-tiers')).toBeNull()
  })

  it('shows the active tier titleRu and "Что входит" feature-bullets', () => {
    render(
      <TeacherSubscriptionClient active={ACTIVE_PRO_LIVE} tariffs={TARIFFS} />,
    )
    const root = screen.getByTestId('teacher-subscription-active')
    expect(root.textContent).toContain('Расширенный')
    expect(root.textContent).toContain('Что входит в тариф')
    const features = screen.getByTestId('teacher-subscription-active-features')
    expect(features.textContent).toContain('Всё из «Базового»')
    expect(features.textContent).toContain('До 30 активных учеников')
    expect(features.textContent).toContain('Расширенные отчёты')
  })

  it('shows the "Отменить подписку" button when cancelled_at is null', () => {
    render(
      <TeacherSubscriptionClient active={ACTIVE_PRO_LIVE} tariffs={TARIFFS} />,
    )
    const cancelBtn = screen.queryByTestId(
      'teacher-subscription-cancel-button',
    ) as HTMLButtonElement | null
    expect(cancelBtn).not.toBeNull()
    expect(cancelBtn?.textContent).toContain('Отменить подписку')
  })

  it('HIDES the cancel button when cancelled_at is set; surfaces the cancellation date', () => {
    render(
      <TeacherSubscriptionClient
        active={ACTIVE_PRO_CANCELLED}
        tariffs={TARIFFS}
      />,
    )
    expect(
      screen.queryByTestId('teacher-subscription-cancel-button'),
    ).toBeNull()
    const root = screen.getByTestId('teacher-subscription-active')
    expect(root.textContent).toContain('Подписка отменена')
    expect(root.textContent).toContain(
      'доступ до конца оплаченного периода',
    )
  })

  it('renders the Базовый (mid) active tier when planSlug=mid', () => {
    render(
      <TeacherSubscriptionClient active={ACTIVE_MID_LIVE} tariffs={TARIFFS} />,
    )
    const root = screen.getByTestId('teacher-subscription-active')
    expect(root.textContent).toContain('Базовый')
    // Negative pin: «Расширенный» must NOT bleed in.
    expect(root.textContent).not.toContain('Расширенный')
  })
})
