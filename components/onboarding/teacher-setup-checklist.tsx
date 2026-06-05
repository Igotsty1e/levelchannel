// Teacher onboarding setup-checklist hint.
//
// Per `docs/plans/onboarding-tooltips-spec-2026-05-31.md §1.1`:
//   - SSR-rendered when ANY of the 4 setup items is incomplete AND
//     the user has not dismissed the hint.
//   - Auto-hidden when all 4 items are complete (regardless of dismiss
//     state — the user finished onboarding).
//   - Dismiss button posts to `POST /api/onboarding/dismiss-hint`
//     with `hintKey: 'teacher_setup_checklist'`. Plan §0e/§0f
//     superseded the kebab-case ID with the snake_case persistence
//     key as the wire value.
//
// Server-rendered card + tiny client-island for the dismiss button.

import Link from 'next/link'

import type { TeacherSetupChecklistState } from '@/lib/onboarding/teacher-setup-checklist'

import { TeacherSetupChecklistDismissButton } from './teacher-setup-checklist-dismiss'

const ITEMS: ReadonlyArray<{
  label: string
  href: string
  pick: (s: TeacherSetupChecklistState) => boolean
}> = [
  {
    label: 'Заполните профиль (имя и часовой пояс)',
    href: '/teacher/profile',
    pick: (s) => s.profileFilled,
  },
  {
    label: 'Создать первый тариф',
    href: '/teacher/tariffs',
    pick: (s) => s.tariffCreated,
  },
  {
    label: 'Подключить Google Calendar',
    href: '/teacher/settings/calendar',
    pick: (s) => s.calendarConnected,
  },
  {
    label: 'Пригласить первого ученика',
    href: '/teacher',
    pick: (s) => s.inviteSent,
  },
]

export function TeacherSetupChecklist({
  state,
}: {
  state: TeacherSetupChecklistState
}) {
  // Render contract:
  //   - allComplete → no render (onboarding finished).
  //   - dismissed → no render (user opted out).
  //   - otherwise → render with item-by-item completion ticks.
  if (state.allComplete || state.dismissed) return null

  return (
    <section
      className="card"
      aria-labelledby="teacher-setup-heading"
      style={{
        padding: 24,
        marginBottom: 24,
        background:
          'linear-gradient(180deg, rgba(110, 168, 254, 0.06), transparent)',
        border: '1px solid var(--accent, #6ea8fe)',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 12,
          marginBottom: 12,
        }}
      >
        <h2
          id="teacher-setup-heading"
          style={{ fontSize: 17, fontWeight: 600, margin: 0 }}
        >
          Настройте кабинет, чтобы начать преподавать
        </h2>
        <TeacherSetupChecklistDismissButton />
      </div>
      <ul
        style={{
          listStyle: 'none',
          padding: 0,
          margin: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        {ITEMS.map((item) => {
          const done = item.pick(state)
          return (
            <li
              key={item.label}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                fontSize: 14,
                lineHeight: 1.5,
                color: done ? 'var(--secondary)' : 'var(--text)',
                textDecoration: done ? 'line-through' : 'none',
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  display: 'inline-flex',
                  width: 18,
                  height: 18,
                  borderRadius: 4,
                  border: '1px solid var(--border)',
                  background: done ? 'var(--accent, #6ea8fe)' : 'transparent',
                  color: '#0a0c10',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 12,
                  fontWeight: 700,
                  flexShrink: 0,
                }}
              >
                {done ? '✓' : ''}
              </span>
              {done ? (
                <span>{item.label}</span>
              ) : (
                <Link
                  href={item.href}
                  style={{
                    color: 'var(--text)',
                    textDecoration: 'underline',
                    textUnderlineOffset: 3,
                  }}
                >
                  {item.label}
                </Link>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
