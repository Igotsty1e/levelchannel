'use client'

/**
 * Teacher cabinet nav — Mobile-first restructure (2026-05-31),
 * design-system refit (2026-06-18).
 *
 * 5 main sections:
 *   1. Главная   — /teacher
 *   2. Календарь — /teacher/calendar (с calendar-dot для GCal-статуса)
 *   3. Занятия   — /teacher/lessons
 *   4. Ученики   — /teacher/learners
 *   5. Настройки — /teacher/settings
 *
 * Mobile (<768px): sticky bottom nav, 5 кнопок с SVG-иконкой+подписью.
 * Desktop (≥768px): горизонтальный nav сверху (text-only).
 *
 * 2026-06-18: заменили Unicode-emoji (⌂ ▦ ≡ ☰ ⚙) на SVG-glyph'ы из
 * `components/ui/icons/`; calendar-dot цвета — design-system tokens
 * (`--success` / `--danger`) вместо хардкода `#9bdf9b` / `#ff8a8a`.
 */

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { NavIcon, type NavIconName } from '@/components/ui/icons'

type NavItem = {
  href: string
  label: string
  icon: NavIconName
  prefixMatch?: boolean
  showCalendarDot?: boolean
}

const NAV_ITEMS: ReadonlyArray<NavItem> = [
  { href: '/teacher', label: 'Главная', icon: 'home' },
  {
    href: '/teacher/calendar',
    label: 'Календарь',
    icon: 'calendar',
    prefixMatch: true,
    showCalendarDot: true,
  },
  {
    href: '/teacher/lessons',
    label: 'Занятия',
    icon: 'lessons',
    prefixMatch: true,
  },
  {
    href: '/teacher/learners',
    label: 'Ученики',
    icon: 'learners',
    prefixMatch: true,
  },
  {
    href: '/teacher/settings',
    label: 'Настройки',
    icon: 'settings-cog',
    prefixMatch: true,
  },
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
  const dotColor = calendarConnected ? 'var(--success)' : 'var(--danger)'

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
                    color: dotColor,
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

      {/* Mobile — sticky bottom nav (<768px). */}
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
                className="cabinet-nav-mobile-icon"
                aria-hidden="true"
                style={{ position: 'relative' }}
              >
                <NavIcon name={item.icon} size={24} />
                {item.showCalendarDot ? (
                  <span
                    aria-hidden="true"
                    data-testid="cabinet-nav-calendar-dot-mobile"
                    data-connected={calendarConnected ? 'true' : 'false'}
                    style={{
                      position: 'absolute',
                      top: -2,
                      right: -6,
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: dotColor,
                    }}
                  />
                ) : null}
              </span>
              <span
                className="cabinet-nav-mobile-label"
                style={{ fontWeight: active ? 600 : 500 }}
              >
                {item.label}
              </span>
            </Link>
          )
        })}
      </nav>
    </>
  )
}
