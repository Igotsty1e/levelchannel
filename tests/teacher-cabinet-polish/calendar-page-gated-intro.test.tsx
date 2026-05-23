// @vitest-environment jsdom

// Teacher cabinet polish — Sub-PR A (TASK-6), round-2 BLOCKER #1 closure.
// Pins the page-level gated intro at /teacher/settings/calendar:
//   - configReady=false → "Эта функция активируется" intro + the
//     "Подключитесь сейчас" CTA paragraph is suppressed entirely.
//   - configReady=true → original two paragraphs (intro + status row
//     with "Подключитесь сейчас") render unchanged.
//
// Test location: lives under `tests/teacher-cabinet-polish/` for the
// same reason as calendar-connect-card.test.tsx (unit runner has jsdom +
// RTL setup; integration runner is node-env + .test.ts only).
//
// Strategy: the page is an `async` server component that reads cookies
// + DB. We mock its boundary calls (next/headers, next/navigation,
// session lookup, config getter, integration + orphan helpers) so the
// only varying input is `configReady`. Then we render the resolved JSX
// and assert the gated copy.

import { render, screen } from '@testing-library/react'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

// Mock the boundary dependencies BEFORE importing the page.
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: (_name: string) => ({ value: 'session-cookie-fixture' }),
  })),
}))

vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`next/navigation redirect called with ${path}`)
  },
}))

vi.mock('next/link', () => ({
  // Render as a plain anchor in jsdom — Next's Link wraps server-render
  // logic we don't need here.
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string
    children: React.ReactNode
  } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

vi.mock('@/lib/auth/sessions', () => ({
  SESSION_COOKIE_NAME: 'lc_session_fixture',
  lookupSession: vi.fn(async () => ({
    account: { id: 'teacher-account-fixture' },
  })),
}))

const getGoogleCalendarOauthConfigMock = vi.fn<() => unknown>(() => null)
vi.mock('@/lib/calendar/google/config', () => ({
  getGoogleCalendarOauthConfig: () => getGoogleCalendarOauthConfigMock(),
}))

vi.mock('@/lib/calendar/integrations', () => ({
  getGoogleIntegrationMeta: vi.fn(async () => null),
}))

vi.mock('@/lib/calendar/orphan-cleanup', () => ({
  listOrphanSelfSlotsForTeacher: vi.fn(async () => []),
}))

// The OrphanSection is a client island that does its own fetch — render
// it as a stub to keep the test focused on the page-level gated intro.
vi.mock('@/app/teacher/settings/calendar/orphan-section', () => ({
  OrphanSection: () => null,
}))

// Stub the connect-card too — it is independently tested in
// calendar-connect-card.test.tsx. This test isolates the page-level copy.
vi.mock('@/app/teacher/settings/calendar/connect-card', () => ({
  CalendarConnectCard: () => null,
}))

import TeacherCalendarSettingsPage from '@/app/teacher/settings/calendar/page'

const searchParamsEmpty = Promise.resolve({})

beforeEach(() => {
  getGoogleCalendarOauthConfigMock.mockReset()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('/teacher/settings/calendar page — gated intro (TASK-6)', () => {
  it('configReady=false → "Эта функция активируется" copy + no "Подключитесь сейчас" CTA paragraph', async () => {
    getGoogleCalendarOauthConfigMock.mockReturnValue(null)

    const jsx = await TeacherCalendarSettingsPage({
      searchParams: searchParamsEmpty,
    })
    render(jsx)

    // Coming-soon intro present.
    expect(
      screen.getByText(/Эта функция активируется в ближайшем обновлении/),
    ).not.toBeNull()
    expect(screen.getByTestId('calendar-coming-soon-intro')).not.toBeNull()

    // Original "Подключите ваш Google Calendar" intro is GONE.
    expect(
      screen.queryByText(/Подключите ваш Google Calendar к LevelChannel/),
    ).toBeNull()

    // Status / CTA paragraph (contains "Подключитесь сейчас") is GONE.
    expect(screen.queryByText(/Подключитесь сейчас/)).toBeNull()
    expect(
      screen.queryByText(/Текущий статус интеграции: подключение готово/),
    ).toBeNull()
  })

  it('configReady=true → original intro + "Подключитесь сейчас" CTA render unchanged', async () => {
    getGoogleCalendarOauthConfigMock.mockReturnValue({
      clientId: 'test-client-id',
      clientSecret: 'test-secret',
      redirectUri: 'https://example.test/api/teacher/calendar/google/callback',
      scope: ['https://www.googleapis.com/auth/calendar'],
    })

    const jsx = await TeacherCalendarSettingsPage({
      searchParams: searchParamsEmpty,
    })
    render(jsx)

    // Original intro present.
    expect(
      screen.getByText(/Подключите ваш Google Calendar к LevelChannel/),
    ).not.toBeNull()

    // Status / CTA paragraph present.
    expect(screen.getByText(/Подключитесь сейчас/)).not.toBeNull()
    expect(
      screen.getByText(/Текущий статус интеграции: подключение готово/),
    ).not.toBeNull()

    // Coming-soon copy is NOT shown when config is ready.
    expect(screen.queryByTestId('calendar-coming-soon-intro')).toBeNull()
    expect(
      screen.queryByText(/Эта функция активируется в ближайшем обновлении/),
    ).toBeNull()
  })
})
