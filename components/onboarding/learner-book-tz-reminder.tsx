'use client'

// Learner onboarding: timezone-mismatch reminder on /cabinet/book.
//
// Per `docs/plans/onboarding-tooltips-spec-2026-05-31.md §1.2`
// (`learner-book-tz-reminder`) + §0d closure for round-4 BLOCKER #4:
// compare browser tz vs LEARNER-PROFILE tz (NOT teacher_tz — the
// booking flow renders times in learner-profile tz already, so the
// real mismatch is between the browser the learner is using NOW and
// the tz they configured in their profile).
//
// Hide cases (no banner):
//   - learner profile tz is null/empty (no comparison anchor),
//   - browser tz matches profile tz,
//   - user dismissed (`tz_hint` in dismissed_hints — passed as
//     prop because the dismissal state is server-resolved).

import Link from 'next/link'
import { useEffect, useState } from 'react'

export function LearnerBookTzReminder({
  learnerTz,
  dismissed,
}: {
  learnerTz: string | null
  dismissed: boolean
}) {
  const [browserTz, setBrowserTz] = useState<string | null>(null)
  const [hideThisSession, setHideThisSession] = useState(false)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    try {
      setBrowserTz(Intl.DateTimeFormat().resolvedOptions().timeZone || null)
    } catch {
      setBrowserTz(null)
    }
  }, [])

  if (
    dismissed
    || hideThisSession
    || !learnerTz
    || browserTz === null
    || browserTz === learnerTz
  ) {
    return null
  }

  async function dismiss() {
    if (pending) return
    setPending(true)
    try {
      await fetch('/api/onboarding/dismiss-hint', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ hintKey: 'tz_hint' }),
      })
      setHideThisSession(true)
    } catch {
      // Keep showing — operator dismiss is best-effort.
    } finally {
      setPending(false)
    }
  }

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        padding: '12px 14px',
        marginBottom: 16,
        borderRadius: 6,
        background: 'rgba(110, 168, 254, 0.10)',
        border: '1px solid var(--accent, #6ea8fe)',
        color: 'var(--text)',
        fontSize: 14,
        lineHeight: 1.55,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        gap: 12,
      }}
    >
      <div style={{ flex: 1 }}>
        Времена показаны в вашем часовом поясе (<strong>{learnerTz}</strong>).
        Сейчас вы открыли страницу из часового пояса{' '}
        <strong>{browserTz}</strong>. Если вы сейчас в другом часовом поясе и
        планируете бронировать оттуда, обновите часовой пояс в{' '}
        <Link
          href="/cabinet/profile#timezone"
          style={{ color: 'var(--accent, #6ea8fe)' }}
        >
          профиле
        </Link>{' '}
        перед бронированием.
      </div>
      <button
        type="button"
        onClick={dismiss}
        disabled={pending}
        aria-label="Скрыть напоминание о часовом поясе"
        style={{
          background: 'transparent',
          border: 'none',
          color: 'var(--secondary)',
          fontSize: 13,
          cursor: pending ? 'not-allowed' : 'pointer',
          padding: '2px 6px',
        }}
      >
        {pending ? '…' : 'Понятно'}
      </button>
    </div>
  )
}
