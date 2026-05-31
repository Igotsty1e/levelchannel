'use client'

/**
 * Teacher cabinet nav — Mobile-first restructure (2026-05-31).
 *
 * 4 main sections instead of 6 cluttered ones:
 *   1. Главная   — /teacher (новый home: ближайшие занятия, invite, ученики)
 *   2. Календарь — /teacher/calendar (бывший /teacher)
 *   3. Ученики   — /teacher/learners
 *   4. Настройки — /teacher/settings (hub для Профиль/Цены занятий/Пакеты уроков/Подписка/Календарь/Уведомления)
 *
 * Mobile (<768px): sticky bottom nav, 4 кнопки с иконкой+подписью.
 * Desktop (≥768px): горизонтальный nav сверху.
 *
 * Calendar connection dot (●/○) — теперь на «Календарь» пункте.
 */

import Link from 'next/link'
import { usePathname } from 'next/navigation'

type NavItem = {
  href: string
  label: string
  /** SVG-glyph icon shown on mobile bottom nav. */
  icon: string
  /** Highlight as active when pathname starts with `href/`. */
  prefixMatch?: boolean
  /** Pass calendar-connected state from SSR. */
  showCalendarDot?: boolean
}

const NAV_ITEMS: ReadonlyArray<NavItem> = [
  { href: '/teacher', label: 'Главная', icon: '⌂' },
  {
    href: '/teacher/calendar',
    label: 'Календарь',
    icon: '▦',
    prefixMatch: true,
    showCalendarDot: true,
  },
  { href: '/teacher/learners', label: 'Ученики', icon: '☰', prefixMatch: true },
  { href: '/teacher/settings', label: 'Настройки', icon: '⚙', prefixMatch: true },
]

type Props = {
  /** SSR-derived: row exists in teacher_calendar_integrations with
   *  sync_state in ('active','degraded'). */
  calendarConnected: boolean
}

function isActive(pathname: string | null, item: NavItem): boolean {
  if (!pathname) return false
  if (!item.prefixMatch) return pathname === item.href
  return pathname === item.href || pathname.startsWith(`${item.href}/`)
}

export function TeacherCabinetNav({ calendarConnected }: Props) {
  const pathname = usePathname()

  return (
    <>
      {/* Desktop / tablet — горизонтальный nav над контентом (≥768px). */}
      <nav
        aria-label="Учительский кабинет"
        data-testid="teacher-cabinet-nav"
        className="cabinet-nav-desktop"
      >
        {NAV_ITEMS.map((item) => {
          const active = isActive(pathname, item)
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              data-active={active ? 'true' : 'false'}
              className="cabinet-nav-link"
              style={{
                color: active ? 'var(--text)' : 'var(--secondary)',
                background: active ? 'var(--border)' : 'transparent',
                fontWeight: active ? 600 : 500,
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
                    marginRight: 4,
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

      {/* Mobile — sticky bottom nav (<768px). 4 иконки + подписи. */}
      <nav
        aria-label="Кабинет (мобильное меню)"
        data-testid="teacher-cabinet-nav-mobile"
        className="cabinet-nav-mobile"
      >
        {NAV_ITEMS.map((item) => {
          const active = isActive(pathname, item)
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              data-active={active ? 'true' : 'false'}
              className="cabinet-nav-mobile-link"
              style={{ color: active ? 'var(--text)' : 'var(--secondary)' }}
            >
              <span
                aria-hidden="true"
                style={{
                  fontSize: 22,
                  lineHeight: 1,
                  marginBottom: 4,
                  position: 'relative',
                }}
              >
                {item.icon}
                {item.showCalendarDot ? (
                  <span
                    aria-hidden="true"
                    style={{
                      position: 'absolute',
                      top: -2,
                      right: -6,
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: calendarConnected ? '#9bdf9b' : '#ff8a8a',
                    }}
                  />
                ) : null}
              </span>
              <span style={{ fontSize: 11, fontWeight: active ? 600 : 500 }}>
                {item.label}
              </span>
            </Link>
          )
        })}
      </nav>
    </>
  )
}
