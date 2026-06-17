'use client'

/**
 * Learner cabinet nav — Mobile-first restructure (2026-06-17).
 *
 * 4 main sections (mirror of TeacherCabinetNav):
 *   1. Главная   — /cabinet (компактный обзор)
 *   2. Занятия   — /cabinet/lessons (полная история — Wave B)
 *   3. Пакеты    — /cabinet/packages
 *   4. Настройки — /cabinet/settings (hub для профиля/интеграций/уведомлений)
 *
 * Mobile (<768px): sticky bottom nav, 4 кнопки с иконкой+подписью.
 * Desktop (≥768px): горизонтальный nav сверху.
 *
 * Owner-feedback 2026-06-17: «Может уже пора сделать тоже нижнее
 * таб меню — "Главная" "Занятия" "Настройки" и разносить потихоньку
 * туда все. Потому что скоро еще другие фичи добавим, на одном
 * экране уже не будет все нормально помещаться».
 */

import Link from 'next/link'
import { usePathname } from 'next/navigation'

type NavItem = {
  href: string
  label: string
  icon: string
  prefixMatch?: boolean
}

const NAV_ITEMS: ReadonlyArray<NavItem> = [
  { href: '/cabinet', label: 'Главная', icon: '⌂' },
  {
    href: '/cabinet/lessons',
    label: 'Занятия',
    icon: '▦',
    prefixMatch: true,
  },
  {
    href: '/cabinet/packages',
    label: 'Пакеты',
    icon: '◫',
    prefixMatch: true,
  },
  {
    href: '/cabinet/settings',
    label: 'Настройки',
    icon: '⚙',
    prefixMatch: true,
  },
]

function isActive(pathname: string | null, item: NavItem): boolean {
  if (!pathname) return false
  if (!item.prefixMatch) return pathname === item.href
  return pathname === item.href || pathname.startsWith(`${item.href}/`)
}

export function LearnerCabinetNav() {
  const pathname = usePathname()

  return (
    <>
      {/* Desktop / tablet — горизонтальный nav над контентом (≥768px). */}
      <nav
        aria-label="Кабинет ученика"
        data-testid="learner-cabinet-nav"
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
              {item.label}
            </Link>
          )
        })}
      </nav>

      {/* Mobile — sticky bottom nav (<768px). */}
      <nav
        aria-label="Кабинет ученика"
        data-testid="learner-cabinet-nav-mobile"
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
              style={{
                color: active ? 'var(--text)' : 'var(--secondary)',
              }}
            >
              <span
                className="cabinet-nav-mobile-icon"
                aria-hidden="true"
                style={{ fontSize: 22, lineHeight: 1 }}
              >
                {item.icon}
              </span>
              <span className="cabinet-nav-mobile-label" style={{ fontSize: 11 }}>
                {item.label}
              </span>
            </Link>
          )
        })}
      </nav>
    </>
  )
}
