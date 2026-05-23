// @vitest-environment jsdom

// Teacher cabinet polish — Sub-PR B (TASK-1).
// Plan: docs/plans/teacher-cabinet-polish.md §3 Sub-PR B.
//
// Pins the load-bearing claims for `<TeacherCabinetNav />`:
//   - All 5 nav buttons render with their canonical hrefs.
//   - pathname === '/teacher'           → Календарь is active.
//   - pathname === '/teacher/learners'  → Ученики is active.
//   - calendarConnected=true            → ● dot (data-connected="true").
//   - calendarConnected=false           → ○ dot (data-connected="false").
//
// Note on test location (matches Sub-PR A's pattern): lives under
// `tests/teacher-cabinet-polish/` rather than the plan's
// `tests/integration/...` path because the integration runner is
// node-env + *.test.ts only; RTL component tests need the unit
// runner's jsdom + setup-rtl.ts.

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// next/navigation must be mocked BEFORE importing the component so the
// vi.mock factory hoisting wires up correctly. We hold a mutable ref
// so individual tests can swap the pathname.
const navState: { pathname: string | null } = { pathname: '/teacher' }

vi.mock('next/navigation', () => ({
  usePathname: () => navState.pathname,
}))

// Import AFTER mock declaration.
import { TeacherCabinetNav } from '@/components/teacher/cabinet-nav'

const EXPECTED_LINKS: Array<{ href: string; label: string }> = [
  { href: '/teacher', label: 'Календарь' },
  { href: '/teacher/learners', label: 'Ученики' },
  { href: '/teacher/packages', label: 'Пакеты' },
  { href: '/teacher/tariffs', label: 'Тарифы' },
  { href: '/teacher/profile', label: 'Профиль' },
]

function findLinkByLabel(label: string): HTMLAnchorElement {
  const links = screen.getAllByRole('link') as HTMLAnchorElement[]
  const match = links.find((a) => a.textContent?.includes(label))
  if (!match) {
    throw new Error(`No link contains label "${label}"`)
  }
  return match
}

describe('TeacherCabinetNav — TASK-1 cabinet nav menu', () => {
  beforeEach(() => {
    navState.pathname = '/teacher'
  })

  afterEach(() => {
    cleanup()
  })

  it('renders all 5 nav buttons with their canonical hrefs', () => {
    render(<TeacherCabinetNav calendarConnected={false} />)

    const links = screen.getAllByRole('link') as HTMLAnchorElement[]
    expect(links.length).toBe(EXPECTED_LINKS.length)

    for (const { href, label } of EXPECTED_LINKS) {
      const link = findLinkByLabel(label)
      // Next.js Link renders an anchor with the href attribute populated
      // for absolute-path strings (no `basePath` configured here).
      expect(link.getAttribute('href')).toBe(href)
      expect(link.textContent).toContain(label)
    }
  })

  it('pathname=/teacher → Календарь is active', () => {
    navState.pathname = '/teacher'
    render(<TeacherCabinetNav calendarConnected={false} />)

    const calendar = findLinkByLabel('Календарь')
    expect(calendar.getAttribute('aria-current')).toBe('page')
    expect(calendar.getAttribute('data-active')).toBe('true')

    // Sibling buttons must NOT be active.
    for (const { label } of EXPECTED_LINKS.filter(
      (l) => l.label !== 'Календарь',
    )) {
      const sibling = findLinkByLabel(label)
      expect(sibling.getAttribute('aria-current')).toBeNull()
      expect(sibling.getAttribute('data-active')).toBe('false')
    }
  })

  it('pathname=/teacher/learners → Ученики is active (and Календарь is NOT)', () => {
    navState.pathname = '/teacher/learners'
    render(<TeacherCabinetNav calendarConnected={false} />)

    const learners = findLinkByLabel('Ученики')
    expect(learners.getAttribute('aria-current')).toBe('page')
    expect(learners.getAttribute('data-active')).toBe('true')

    // Calendar's exact-match rule means deeper /teacher/* routes
    // must NOT keep Календарь lit (round-5 design intent).
    const calendar = findLinkByLabel('Календарь')
    expect(calendar.getAttribute('aria-current')).toBeNull()
    expect(calendar.getAttribute('data-active')).toBe('false')
  })

  it('pathname=/teacher/learners/abc → Ученики stays active (prefix match for sub-routes)', () => {
    navState.pathname = '/teacher/learners/abc-uuid'
    render(<TeacherCabinetNav calendarConnected={false} />)

    const learners = findLinkByLabel('Ученики')
    expect(learners.getAttribute('aria-current')).toBe('page')
    expect(learners.getAttribute('data-active')).toBe('true')
  })

  it('calendarConnected=true → green ● dot on Календарь', () => {
    navState.pathname = '/teacher'
    render(<TeacherCabinetNav calendarConnected={true} />)

    const dot = screen.getByTestId('cabinet-nav-calendar-dot')
    expect(dot.getAttribute('data-connected')).toBe('true')
    expect(dot.textContent).toBe('●')
    expect(dot.getAttribute('aria-label')).toContain('подключён')
  })

  it('calendarConnected=false → grey ○ dot on Календарь', () => {
    navState.pathname = '/teacher'
    render(<TeacherCabinetNav calendarConnected={false} />)

    const dot = screen.getByTestId('cabinet-nav-calendar-dot')
    expect(dot.getAttribute('data-connected')).toBe('false')
    expect(dot.textContent).toBe('○')
    expect(dot.getAttribute('aria-label')).toContain('не подключён')
  })

  it('only Календарь has a connection-state dot; siblings do not', () => {
    render(<TeacherCabinetNav calendarConnected={true} />)

    // The dot's testid is unique-rendered — exactly one in the DOM.
    const dots = screen.getAllByTestId('cabinet-nav-calendar-dot')
    expect(dots.length).toBe(1)
  })
})
