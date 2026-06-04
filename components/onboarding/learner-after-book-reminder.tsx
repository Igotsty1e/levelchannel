// Learner onboarding: post-book reminder banner shown on /cabinet
// when ?booked=1 is set + the learner hasn't dismissed.
//
// Per `docs/plans/onboarding-tooltips-spec-2026-05-31.md §1.2` +
// round-3 §0d Closure for BLOCKER #3: confirm-form pushes to
// /cabinet?booked=1 (NOT /cabinet/book — that route never re-renders
// after navigation). The banner lives on the cabinet home so the
// learner sees it right after their first booking.

import Link from 'next/link'

import { LearnerAfterBookReminderDismissButton } from './learner-after-book-reminder-dismiss'

export function LearnerAfterBookReminder({
  shouldRender,
}: {
  shouldRender: boolean
}) {
  if (!shouldRender) return null

  return (
    <section
      role="status"
      aria-live="polite"
      style={{
        padding: '14px 16px',
        marginBottom: 24,
        borderRadius: 6,
        background: 'rgba(110, 168, 254, 0.10)',
        border: '1px solid var(--accent, #6ea8fe)',
        color: 'var(--text)',
        fontSize: 14,
        lineHeight: 1.55,
        display: 'flex',
        gap: 12,
        alignItems: 'flex-start',
      }}
    >
      <div style={{ flex: 1 }}>
        Запись принята. Чтобы не забыть про занятие, подключите
        напоминания — мы пришлём оповещение в Telegram или на e-mail за
        несколько часов до старта.{' '}
        <Link
          href="/cabinet/settings/reminders"
          style={{
            color: 'var(--accent, #6ea8fe)',
            fontWeight: 600,
          }}
        >
          Настроить напоминания →
        </Link>
      </div>
      <LearnerAfterBookReminderDismissButton />
    </section>
  )
}
