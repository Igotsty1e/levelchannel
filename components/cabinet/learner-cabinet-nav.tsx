'use client'

/**
 * Learner cabinet nav — Mobile-first restructure (2026-06-17),
 * design-system refit (2026-06-18).
 *
 * 5 main sections (mirror of TeacherCabinetNav):
 *   1. Главная   — /cabinet
 *   2. Календарь — /cabinet/book
 *   3. Занятия   — /cabinet/lessons
 *   4. Пакеты    — /cabinet/packages
 *   5. Настройки — /cabinet/settings
 *
 * Mobile (<768px): sticky bottom nav, 5 кнопок с SVG-иконкой+подписью.
 * Desktop (≥768px): горизонтальный nav сверху (text-only).
 *
 * 2026-06-18: заменили Unicode-emoji (⌂ ▦ ≡ ◫ ⚙) на SVG-glyph'ы из
 * `components/ui/icons/`; убрали inline fontSize/lineHeight (стили
 * живут в `app/globals.css` под `.cabinet-nav-mobile-icon/label`).
 */

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { NavIcon, type NavIconName } from '@/components/ui/icons'

type NavItem = {
  href: string
  label: string
  icon: NavIconName
  prefixMatch?: boolean
}

const NAV_ITEMS: ReadonlyArray<NavItem> = [
  { href: '/cabinet', label: 'Главная', icon: 'home' },
  {
    href: '/cabinet/book',
    label: 'Календарь',
    icon: 'calendar',
    prefixMatch: true,
  },
  {
    href: '/cabinet/lessons',
    label: 'Занятия',
    icon: 'lessons',
    prefixMatch: true,
  },
  {
    href: '/cabinet/packages',
    label: 'Пакеты',
    icon: 'packages',
    prefixMatch: true,
  },
  {
    href: '/cabinet/settings',
    label: 'Настройки',
    icon: 'gear',
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
              <span className="cabinet-nav-mobile-icon" aria-hidden="true">
                <NavIcon name={item.icon} size={24} />
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
