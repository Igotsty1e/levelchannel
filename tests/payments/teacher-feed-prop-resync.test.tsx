// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ClaimsFeed } from '@/app/teacher/payments/feed'
import type { ClaimRow } from '@/lib/payments/sbp-claims'

// Regression test for the «История (N)» counter desync seen during the
// 2026-06-08 QA walkthrough: ClaimsFeed used to seed local state once
// (useState(initialClaims)) and ignored subsequent prop changes, so the
// SSR-level «Подтверждено за месяц» card updated after router.refresh()
// but the client-side tab counter stayed at 0 until full reload.
//
// The fix added useEffect to resync local state when the parent passes
// a new array reference. This test re-renders the component with a
// fresh `initialClaims` and asserts the tab label reflects it.

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}))

function makeClaim(id: string, status: ClaimRow['status']): ClaimRow {
  return {
    id,
    status,
    learnerAccountId: 'L1',
    learnerName: 'Test Learner',
    teacherAccountId: 'T1',
    teacherName: 'Test Teacher',
    amountKopecks: 100_000,
    paymentChannel: 'sbp',
    paymentMethodPhone: '+7 (999) 123-45-67',
    paymentMethodBank: 'Тинькофф',
    initiatedBy: 'teacher',
    amountMismatchKopecks: 0,
    noteLearner: null,
    noteTeacher: null,
    claimedAt: '2026-06-08T07:00:00Z',
    paidAt: '2026-06-08T07:00:00Z',
    resolvedAt: '2026-06-08T07:00:00Z',
    items: [],
  }
}

describe('ClaimsFeed — prop resync after router.refresh', () => {
  it('reflects new initialClaims on re-render (no stale local state)', () => {
    const { rerender } = render(
      <ClaimsFeed initialClaims={[]} initialRefunds={[]} />,
    )
    expect(screen.getByRole('tab', { name: /История \(0\)/ })).toBeTruthy()

    rerender(
      <ClaimsFeed
        initialClaims={[makeClaim('c1', 'confirmed')]}
        initialRefunds={[]}
      />,
    )
    // The history-tab counter must follow the new claims length.
    expect(screen.getByRole('tab', { name: /История \(1\)/ })).toBeTruthy()
  })
})
