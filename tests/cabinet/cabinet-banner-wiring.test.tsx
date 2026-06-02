// @vitest-environment jsdom

// Plan: docs/plans/bug-1-payment-method-banner.md §Tests Test 2.
// Render-level wiring test for both branches that render the missing-
// payment-method banner. Pins:
//
// 1. <LessonsSection> short-circuit ordering — banner replaces
//    «Открыть календарь» CTA when paymentMethodNotSet === true.
// 2. <TeacherBlocksList> per-block — banner replaces «Записаться к
//    этому учителю» CTA when block.paymentMethod === 'none'.
//
// Mirrors `tests/cabinet/calendar-settings-state-matrix.test.tsx`
// idiom (no jest-dom matcher chains — read text/attrs directly from
// the DOM node to avoid TS-side ambient-typing on `Assertion`).

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string
    children: React.ReactNode
  } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

// useSearchParams is referenced by LessonsSection BookingCta; provide a
// stable stub that returns empty params (no `?booked=1`).
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(''),
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}))

import { LessonsSection } from '@/app/cabinet/lessons-section'
import { TeacherBlocksList } from '@/app/cabinet/teacher-blocks-list'

// LessonsSection has many optional props; define a full baseline and
// override only the bits each test cares about.
type LessonsProps = React.ComponentProps<typeof LessonsSection>

function lessonsProps(overrides: Partial<LessonsProps> = {}): LessonsProps {
  return {
    initialMine: [],
    initialAvailable: [],
    learnerTimezone: 'Europe/Moscow',
    emailVerified: true,
    initialPaidSlotIds: [],
    initialRefundedSlotIds: [],
    hasAssignedTeacher: true,
    assignedTeacherId: 'teacher-1',
    activePackages: [],
    billingWaveActive: false,
    cancelWindowHours: 24,
    paymentMethodNotSet: false,
    canBuyPackages: false,
    ...overrides,
  }
}

type BlocksProps = React.ComponentProps<typeof TeacherBlocksList>
type Block = BlocksProps['blocks'][number]

function block(overrides: Partial<Block> = {}): Block {
  return {
    teacherId: 't-1',
    teacherDisplayName: 'Учитель A',
    upcomingSlots: [],
    balanceOwedKopecks: 0,
    debtSlotCount: 0,
    activePackageCount: 0,
    paymentMethod: 'postpaid',
    ...overrides,
  }
}

describe('<LessonsSection> — Bug #1 banner wiring', () => {
  it('paymentMethodNotSet=true renders the banner and HIDES «Открыть календарь»', () => {
    render(<LessonsSection {...lessonsProps({ paymentMethodNotSet: true })} />)
    expect(
      screen.queryByTestId('missing-payment-method-banner'),
    ).not.toBeNull()
    expect(screen.queryByText('Открыть календарь')).toBeNull()
  })

  it('paymentMethodNotSet=false renders «Открыть календарь» and HIDES the banner', () => {
    render(<LessonsSection {...lessonsProps({ paymentMethodNotSet: false })} />)
    expect(screen.queryByTestId('missing-payment-method-banner')).toBeNull()
    expect(screen.queryByText('Открыть календарь')).not.toBeNull()
  })

  it('!emailVerified short-circuits BEFORE the banner (e-mail hint wins)', () => {
    render(
      <LessonsSection
        {...lessonsProps({
          emailVerified: false,
          paymentMethodNotSet: true,
        })}
      />,
    )
    expect(screen.queryByTestId('missing-payment-method-banner')).toBeNull()
    const hint = screen.queryByText(/подтвердите e-mail/i)
    expect(hint).not.toBeNull()
  })
})

describe('<TeacherBlocksList> — Bug #1 per-block banner', () => {
  it("block.paymentMethod='none' renders the banner instead of the link", () => {
    render(
      <TeacherBlocksList
        blocks={[block({ paymentMethod: 'none' })]}
        learnerTimezone="Europe/Moscow"
        canBuyPackages={true}
      />,
    )
    expect(
      screen.queryByTestId('missing-payment-method-banner'),
    ).not.toBeNull()
    expect(screen.queryByText('Записаться к этому учителю')).toBeNull()
  })

  it('mixed blocks: one banner per none-block, link per non-none block', () => {
    render(
      <TeacherBlocksList
        blocks={[
          block({
            teacherId: 't-1',
            teacherDisplayName: 'A',
            paymentMethod: 'none',
          }),
          block({
            teacherId: 't-2',
            teacherDisplayName: 'B',
            paymentMethod: 'postpaid',
          }),
        ]}
        learnerTimezone="Europe/Moscow"
        canBuyPackages={false}
      />,
    )
    const banners = screen.getAllByTestId('missing-payment-method-banner')
    expect(banners).toHaveLength(1)
    const links = screen.getAllByText('Записаться к этому учителю')
    expect(links).toHaveLength(1)
  })

  it("block.paymentMethod='prepaid_packages' renders the link, NOT the banner", () => {
    render(
      <TeacherBlocksList
        blocks={[block({ paymentMethod: 'prepaid_packages' })]}
        learnerTimezone="Europe/Moscow"
        canBuyPackages={false}
      />,
    )
    expect(screen.queryByTestId('missing-payment-method-banner')).toBeNull()
    expect(screen.queryByText('Записаться к этому учителю')).not.toBeNull()
  })
})
