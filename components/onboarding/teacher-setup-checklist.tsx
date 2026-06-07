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
    label: 'Профиль',
    href: '/teacher/profile',
    pick: (s) => s.profileFilled,
  },
  {
    label: 'Тариф',
    href: '/teacher/tariffs',
    pick: (s) => s.tariffCreated,
  },
  {
    label: 'Календарь',
    href: '/teacher/settings/calendar',
    pick: (s) => s.calendarConnected,
  },
  {
    label: 'Ученик',
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

  const doneCount = ITEMS.reduce((n, it) => n + (it.pick(state) ? 1 : 0), 0)
  const total = ITEMS.length
  const progressPct = Math.round((doneCount / total) * 100)

  return (
    <section
      className="card"
      aria-labelledby="teacher-setup-heading"
      style={{
        padding: 24,
        marginBottom: 24,
        background:
          'linear-gradient(180deg, rgba(110, 168, 254, 0.08), rgba(110, 168, 254, 0.02))',
        border: '1px solid var(--accent, #6ea8fe)',
        borderRadius: 12,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 12,
          marginBottom: 16,
        }}
      >
        <div>
          <h2
            id="teacher-setup-heading"
            style={{ fontSize: 17, fontWeight: 600, margin: 0, marginBottom: 4 }}
          >
            Что осталось настроить
          </h2>
          <p
            style={{
              margin: 0,
              fontSize: 13,
              color: 'var(--secondary)',
            }}
          >
            {doneCount} из {total}
          </p>
        </div>
        <TeacherSetupChecklistDismissButton />
      </div>

      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={doneCount}
        aria-label="Прогресс настройки"
        style={{
          height: 6,
          borderRadius: 999,
          background: 'rgba(255,255,255,0.06)',
          overflow: 'hidden',
          marginBottom: 18,
        }}
      >
        <div
          style={{
            width: `${progressPct}%`,
            height: '100%',
            background: 'var(--accent, #6ea8fe)',
            transition: 'width 240ms ease-out',
          }}
        />
      </div>

      <ul
        className="onboarding-checklist-grid"
        style={{
          listStyle: 'none',
          padding: 0,
          margin: 0,
          display: 'grid',
          gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
          gap: 12,
        }}
      >
        {ITEMS.map((item) => {
          const done = item.pick(state)
          const cardStyle: React.CSSProperties = {
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '12px 14px',
            borderRadius: 10,
            border: `1px solid ${done ? 'rgba(155,223,155,0.25)' : 'var(--border)'}`,
            background: done ? 'rgba(155,223,155,0.06)' : 'transparent',
            color: done ? 'var(--secondary)' : 'var(--text)',
            fontSize: 14,
            fontWeight: 500,
            lineHeight: 1.2,
            textDecoration: 'none',
            transition: 'background 160ms ease, border-color 160ms ease',
            height: '100%',
            minHeight: 56,
            width: '100%',
            boxSizing: 'border-box',
          }
          const inner = (
            <>
              <span
                aria-hidden="true"
                style={{
                  display: 'inline-flex',
                  width: 22,
                  height: 22,
                  borderRadius: '50%',
                  border: `1.5px solid ${done ? '#9bdf9b' : 'var(--border)'}`,
                  background: done ? '#9bdf9b' : 'transparent',
                  color: '#0a0c10',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 13,
                  fontWeight: 700,
                  flexShrink: 0,
                }}
              >
                {done ? '✓' : ''}
              </span>
              <span style={{ flex: 1, minWidth: 0, lineHeight: 1.3 }}>
                {item.label}
              </span>
              {!done ? (
                <span
                  aria-hidden="true"
                  style={{
                    color: 'var(--accent, #6ea8fe)',
                    fontSize: 16,
                    flexShrink: 0,
                  }}
                >
                  →
                </span>
              ) : null}
            </>
          )
          return (
            <li key={item.label} style={{ display: 'flex' }}>
              {done ? (
                <div style={cardStyle}>{inner}</div>
              ) : (
                <Link href={item.href} style={cardStyle}>
                  {inner}
                </Link>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
