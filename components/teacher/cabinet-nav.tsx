'use client'

// Teacher cabinet polish — Sub-PR B (TASK-1).
//
// Plan: docs/plans/teacher-cabinet-polish.md §3 Sub-PR B.
//
// Top-level cabinet nav shown on every /teacher/* route. Lives BELOW
// <SiteHeader /> (rendered by app/teacher/layout.tsx, ABOVE the page
// children). Active-route highlight is computed client-side via
// usePathname() — that's the only reason this leaf is `'use client'`;
// the parent layout stays server-side and feeds calendarConnected as
// SSR-derived prop.
//
// The Календарь button carries a connection-state dot (● connected /
// ○ not) per round-5 BLOCKER #1 closure / Q11. The dot replaces the
// inline status row that used to live at the top of /teacher/page.tsx
// — single source of truth for calendar connection visibility.

import Link from 'next/link'
import { usePathname } from 'next/navigation'

type NavItem = {
  href: string
  label: string
  /** If true, show ●/○ connection-state dot before label. */
  showCalendarDot?: boolean
}

const NAV_ITEMS: ReadonlyArray<NavItem> = [
  { href: '/teacher', label: 'Календарь', showCalendarDot: true },
  { href: '/teacher/learners', label: 'Ученики' },
  { href: '/teacher/packages', label: 'Пакеты' },
  { href: '/teacher/tariffs', label: 'Тарифы' },
  { href: '/teacher/profile', label: 'Профиль' },
]

type Props = {
  /** SSR-derived: row exists in teacher_calendar_integrations with
   *  sync_state in ('active','degraded'). */
  calendarConnected: boolean
}

/**
 * Returns true when `pathname` should highlight `href` as the active
 * route. Exact match for the dashboard (`/teacher`) so visiting a
 * deeper route doesn't keep Календарь lit; prefix match for the
 * sub-routes so e.g. `/teacher/learners/abc` still highlights Ученики.
 */
function isActive(pathname: string | null, href: string): boolean {
  if (!pathname) return false
  if (href === '/teacher') {
    return pathname === '/teacher'
  }
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function TeacherCabinetNav({ calendarConnected }: Props) {
  const pathname = usePathname()

  return (
    <nav
      aria-label="Учительский кабинет"
      data-testid="teacher-cabinet-nav"
      style={{
        display: 'flex',
        gap: 8,
        flexWrap: 'wrap',
        marginBottom: 20,
        padding: '8px 0',
        borderBottom: '1px solid var(--border)',
      }}
    >
      {NAV_ITEMS.map((item) => {
        const active = isActive(pathname, item.href)
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            data-active={active ? 'true' : 'false'}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 14px',
              borderRadius: 8,
              fontSize: 14,
              fontWeight: active ? 600 : 500,
              textDecoration: 'none',
              color: active ? 'var(--text)' : 'var(--secondary)',
              background: active ? 'var(--border)' : 'transparent',
              border: '1px solid',
              borderColor: active ? 'var(--border)' : 'transparent',
              transition: 'background 0.12s ease, color 0.12s ease',
            }}
          >
            {item.showCalendarDot ? (
              <span
                aria-label={
                  calendarConnected
                    ? 'Google Calendar подключён'
                    : 'Google Calendar не подключён'
                }
                data-testid="cabinet-nav-calendar-dot"
                data-connected={calendarConnected ? 'true' : 'false'}
                style={{
                  color: calendarConnected ? '#9bdf9b' : '#ff8a8a',
                  fontSize: 12,
                  lineHeight: 1,
                }}
              >
                {calendarConnected ? '●' : '○'}
              </span>
            ) : null}
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}
