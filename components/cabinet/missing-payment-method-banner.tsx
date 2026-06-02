'use client'

// Bug #1 (2026-06-02). Server-derived UX banner shown on cabinet home
// BEFORE the calendar entry-point. Renders when the per-pair
// `learner_billing_preferences.payment_method` is `'none'` (or the row
// is missing) for the learner's teacher(s).
//
// Plan: docs/plans/bug-1-payment-method-banner.md
//
// Why `'use client'`: both consumers (`app/cabinet/lessons-section.tsx`,
// `app/cabinet/teacher-blocks-list.tsx`) are themselves client
// components — a pure-RSC banner would not be importable from those
// client trees. The directive is module-boundary only; the component
// has no hooks / no state. Pure render.
//
// Defense-in-depth: this banner is the UX entry-path improvement only.
// The server-side gate stays in `lib/scheduling/slots/booking.ts:249-252`
// (rejects with `payment_method_not_set`); the route handler at
// `app/api/slots/[id]/book/route.ts` maps that reason to a 422 with the
// same copy so deep-link / stale-tab learners get an honest message at
// submit-time.

import React from 'react'

export type MissingPaymentMethodBannerProps = {
  // `single` — only one assigned teacher; banner replaces the entire
  // «Открыть календарь» CTA inside `LessonsSection`.
  // `per-teacher` — multi-link learner; banner replaces «Записаться к
  // этому учителю» inside one block (others may still book).
  variant: 'single' | 'per-teacher'
  // Server-side SoT: matches the same predicate used to decide whether
  // to show «Купить пакет →» in `app/cabinet/billing-sections.tsx`
  // (`isLearnerArchetypeCandidate`). When true, the banner adds a
  // second paragraph defusing the contradiction: pre-buying a package
  // does not unblock booking — the teacher must pick a method first.
  canBuyPackages: boolean
}

const COPY_LINE_1: Record<MissingPaymentMethodBannerProps['variant'], string> = {
  single:
    'Вы пока не можете забронировать занятие. Учитель должен выбрать модель оплаты за занятия.',
  'per-teacher':
    'Вы пока не можете забронировать занятие у этого учителя. Учитель должен выбрать модель оплаты за занятия.',
}

const COPY_LINE_2 =
  'Не нужно ничего покупать заранее — сначала дождитесь, пока учитель выберет способ оплаты.'

export function MissingPaymentMethodBanner({
  variant,
  canBuyPackages,
}: MissingPaymentMethodBannerProps) {
  return (
    <div
      role="status"
      data-testid="missing-payment-method-banner"
      data-variant={variant}
      style={{
        background: 'rgba(255,196,0,0.12)',
        color: '#ffd166',
        border: '1px solid rgba(255,196,0,0.35)',
        borderRadius: 8,
        padding: '12px 16px',
        fontSize: 14,
        lineHeight: 1.5,
        margin: 0,
      }}
    >
      <p style={{ margin: 0 }}>{COPY_LINE_1[variant]}</p>
      {canBuyPackages ? (
        <p style={{ margin: '8px 0 0 0', fontSize: 13, opacity: 0.85 }}>
          {COPY_LINE_2}
        </p>
      ) : null}
    </div>
  )
}
