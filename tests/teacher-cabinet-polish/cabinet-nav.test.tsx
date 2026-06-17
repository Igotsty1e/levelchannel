// @vitest-environment jsdom

// Mobile-first cabinet restructure (2026-05-31) — обновлённые pin'ы:
//   - 4 главных раздела × 2 nav'a (desktop + mobile bottom) = 8 ссылок.
//   - Главная / Календарь / Ученики / Настройки.
//   - pathname === '/teacher'           → Главная active.
//   - pathname === '/teacher/calendar'  → Календарь active.
//   - pathname === '/teacher/learners'  → Ученики active.
//   - pathname === '/teacher/settings'  → Настройки active.
//   - calendarConnected dot теперь на «Календарь» пункте.

import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const navState: { pathname: string | null } = { pathname: '/teacher' }

vi.mock('next/navigation', () => ({
  usePathname: () => navState.pathname,
}))

import { TeacherCabinetNav } from '@/components/teacher/cabinet-nav'

const EXPECTED_LINKS: Array<{ href: string; label: string }> = [
  { href: '/teacher', label: 'Главная' },
  { href: '/teacher/calendar', label: 'Календарь' },
  { href: '/teacher/lessons', label: 'Занятия' },
  { href: '/teacher/learners', label: 'Ученики' },
  { href: '/teacher/settings', label: 'Настройки' },
]

function findDesktopLinkByLabel(label: string): HTMLAnchorElement {
  const desktopNav = screen.getByTestId('teacher-cabinet-nav')
  const links = within(desktopNav).getAllByRole(
    'link',
  ) as HTMLAnchorElement[]
  const match = links.find((a) => a.textContent?.includes(label))
  if (!match) {
    throw new Error(`No desktop link contains label "${label}"`)
  }
  return match
}

describe('TeacherCabinetNav — mobile-first restructure', () => {
  beforeEach(() => {
    navState.pathname = '/teacher'
  })

  afterEach(() => {
    cleanup()
  })

  it('renders 5 sections in BOTH desktop and mobile nav', () => {
    render(<TeacherCabinetNav calendarConnected={false} />)
    const desktopNav = screen.getByTestId('teacher-cabinet-nav')
    const mobileNav = screen.getByTestId('teacher-cabinet-nav-mobile')
    expect(within(desktopNav).getAllByRole('link').length).toBe(
      EXPECTED_LINKS.length,
    )
    expect(within(mobileNav).getAllByRole('link').length).toBe(
      EXPECTED_LINKS.length,
    )
  })

  it('renders all 5 canonical hrefs in desktop nav', () => {
    render(<TeacherCabinetNav calendarConnected={false} />)
    for (const { href, label } of EXPECTED_LINKS) {
      const link = findDesktopLinkByLabel(label)
      expect(link.getAttribute('href')).toBe(href)
      expect(link.textContent).toContain(label)
    }
  })

  it('pathname=/teacher → Главная is active (exact match, not prefix)', () => {
    navState.pathname = '/teacher'
    render(<TeacherCabinetNav calendarConnected={false} />)
    const home = findDesktopLinkByLabel('Главная')
    expect(home.getAttribute('aria-current')).toBe('page')
    expect(home.getAttribute('data-active')).toBe('true')

    for (const { label } of EXPECTED_LINKS.filter(
      (l) => l.label !== 'Главная',
    )) {
      const sibling = findDesktopLinkByLabel(label)
      expect(sibling.getAttribute('aria-current')).toBeNull()
      expect(sibling.getAttribute('data-active')).toBe('false')
    }
  })

  it('pathname=/teacher/calendar → Календарь active (and Главная NOT)', () => {
    navState.pathname = '/teacher/calendar'
    render(<TeacherCabinetNav calendarConnected={false} />)
    const cal = findDesktopLinkByLabel('Календарь')
    expect(cal.getAttribute('aria-current')).toBe('page')
    expect(cal.getAttribute('data-active')).toBe('true')

    const home = findDesktopLinkByLabel('Главная')
    expect(home.getAttribute('aria-current')).toBeNull()
  })

  it('pathname=/teacher/learners → Ученики active', () => {
    navState.pathname = '/teacher/learners'
    render(<TeacherCabinetNav calendarConnected={false} />)
    const learners = findDesktopLinkByLabel('Ученики')
    expect(learners.getAttribute('aria-current')).toBe('page')
  })

  it('pathname=/teacher/learners/abc → Ученики stays active (prefix)', () => {
    navState.pathname = '/teacher/learners/abc-uuid'
    render(<TeacherCabinetNav calendarConnected={false} />)
    const learners = findDesktopLinkByLabel('Ученики')
    expect(learners.getAttribute('aria-current')).toBe('page')
  })

  it('pathname=/teacher/settings/calendar → Настройки stays active (prefix)', () => {
    navState.pathname = '/teacher/settings/calendar'
    render(<TeacherCabinetNav calendarConnected={false} />)
    const settings = findDesktopLinkByLabel('Настройки')
    expect(settings.getAttribute('aria-current')).toBe('page')
  })

  it('calendarConnected=true → green ● dot on Календарь (desktop)', () => {
    navState.pathname = '/teacher'
    render(<TeacherCabinetNav calendarConnected={true} />)
    const dot = screen.getByTestId('cabinet-nav-calendar-dot')
    expect(dot.getAttribute('data-connected')).toBe('true')
    expect(dot.textContent).toBe('●')
  })

  it('calendarConnected=false → grey ○ dot on Календарь (desktop)', () => {
    navState.pathname = '/teacher'
    render(<TeacherCabinetNav calendarConnected={false} />)
    const dot = screen.getByTestId('cabinet-nav-calendar-dot')
    expect(dot.getAttribute('data-connected')).toBe('false')
    expect(dot.textContent).toBe('○')
  })
})
