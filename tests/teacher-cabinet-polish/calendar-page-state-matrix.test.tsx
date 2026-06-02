// @vitest-environment jsdom

// Plan: docs/plans/cabinet-stale-future-labels.md §B.3.
// Renders /teacher/settings/calendar across the (pullStatus × pushStatus)
// matrix to pin exact intro/bullet copy per state. Mirrors the learner
// matrix test in tests/cabinet/.

import { render, screen } from '@testing-library/react'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import type { TeacherCalendarIntegrationRecord } from '@/lib/calendar/integrations'

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

vi.mock('@/lib/calendar/google/config', () => ({
  getGoogleCalendarOauthConfig: () => ({
    clientId: 'test-client',
    clientSecret: 'test-secret',
    redirectUri: 'https://example.test/cb',
    scope: ['https://www.googleapis.com/auth/calendar'],
  }),
}))

const integrationMock = vi.fn<
  () => Promise<TeacherCalendarIntegrationRecord | null>
>(async () => null)
vi.mock('@/lib/calendar/integrations', () => ({
  getGoogleIntegrationMeta: () => integrationMock(),
}))

vi.mock('@/lib/calendar/orphan-cleanup', () => ({
  listOrphanSelfSlotsForTeacher: vi.fn(async () => []),
}))

vi.mock('@/app/teacher/settings/calendar/orphan-section', () => ({
  OrphanSection: () => null,
}))

vi.mock('@/app/teacher/settings/calendar/connect-card', () => ({
  CalendarConnectCard: () => null,
}))

import TeacherCalendarSettingsPage from '@/app/teacher/settings/calendar/page'

const now = new Date('2026-06-02T12:00:00Z')

function record(
  overrides: Partial<TeacherCalendarIntegrationRecord> = {},
): TeacherCalendarIntegrationRecord {
  return {
    accountId: 'teacher-account-fixture',
    provider: 'google',
    syncState: 'active',
    epoch: '1',
    scope: null,
    tokenExpiresAt: null,
    readCalendarIds: [],
    writeCalendarId: 'primary',
    lastPulledAt: now.toISOString(),
    lastPushAt: null,
    lastReconnectedAt: null,
    lastError: null,
    channelId: null,
    channelResourceId: null,
    channelExpiresAt: null,
    channelToken: null,
    lastSeenMessageNumber: null,
    nextSyncToken: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    ...overrides,
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(now)
})

afterEach(() => {
  vi.useRealTimers()
  integrationMock.mockReset()
  integrationMock.mockResolvedValue(null)
})

async function renderPage() {
  const jsx = await TeacherCalendarSettingsPage({
    searchParams: Promise.resolve({}),
  })
  render(jsx)
}

describe('/teacher/settings/calendar — intro copy by (pull × push)', () => {
  it('active_fresh + works → "✓ Работает сейчас"', async () => {
    integrationMock.mockResolvedValue(
      record({
        syncState: 'active',
        writeCalendarId: 'primary',
        lastPulledAt: new Date(now.getTime() - 60 * 1000).toISOString(),
      }),
    )
    await renderPage()
    expect(screen.getByTestId('teacher-calendar-intro').textContent).toMatch(
      /✓ Работает сейчас/,
    )
  })

  it('active_fresh + no_write_calendar → "Выберите календарь для записи"', async () => {
    integrationMock.mockResolvedValue(
      record({
        syncState: 'active',
        writeCalendarId: null,
        lastPulledAt: new Date(now.getTime() - 60 * 1000).toISOString(),
      }),
    )
    await renderPage()
    expect(screen.getByTestId('teacher-calendar-intro').textContent).toMatch(
      /Выберите календарь для записи занятий/,
    )
  })

  it('active_stale → "синхронизация сейчас отстаёт"', async () => {
    integrationMock.mockResolvedValue(
      record({
        syncState: 'active',
        lastPulledAt: new Date(now.getTime() - 15 * 60 * 1000).toISOString(),
      }),
    )
    await renderPage()
    expect(screen.getByTestId('teacher-calendar-intro').textContent).toMatch(
      /синхронизация сейчас отстаёт/,
    )
  })

  it('degraded → "синхронизация сейчас отстаёт"', async () => {
    integrationMock.mockResolvedValue(record({ syncState: 'degraded' }))
    await renderPage()
    expect(screen.getByTestId('teacher-calendar-intro').textContent).toMatch(
      /синхронизация сейчас отстаёт/,
    )
  })

  it('no_integration → call-to-action without teaser', async () => {
    integrationMock.mockResolvedValue(null)
    await renderPage()
    const intro = screen.getByTestId('teacher-calendar-intro').textContent ?? ''
    expect(intro).toMatch(/Подключите ваш Google Calendar/)
    expect(intro).not.toMatch(/появится в ближайших обновлениях/)
  })

  it('disconnected → call-to-action without teaser', async () => {
    integrationMock.mockResolvedValue(record({ syncState: 'disconnected' }))
    await renderPage()
    const intro = screen.getByTestId('teacher-calendar-intro').textContent ?? ''
    expect(intro).toMatch(/Подключите ваш Google Calendar/)
  })
})

describe('/teacher/settings/calendar — list block "Как работает"', () => {
  it('heading is factual (no "по мере включения")', async () => {
    integrationMock.mockResolvedValue(null)
    await renderPage()
    expect(
      screen.getByTestId('teacher-calendar-list-heading').textContent,
    ).toBe('Как работает интеграция с Google Calendar')
  })

  it('active_fresh + works → all 3 dynamic bullets visible with "✓ Работает сейчас"', async () => {
    integrationMock.mockResolvedValue(
      record({
        syncState: 'active',
        writeCalendarId: 'primary',
        lastPulledAt: new Date(now.getTime() - 60 * 1000).toISOString(),
      }),
    )
    await renderPage()
    expect(screen.getByTestId('teacher-bullet-read').textContent).toMatch(
      /✓ Работает сейчас/,
    )
    expect(screen.getByTestId('teacher-bullet-write').textContent).toMatch(
      /✓ Работает сейчас/,
    )
    expect(screen.getByTestId('teacher-bullet-conflicts').textContent).toMatch(
      /✓ Работает сейчас/,
    )
  })

  it('active_fresh + no_write_calendar → write bullet says "Выберите календарь"', async () => {
    integrationMock.mockResolvedValue(
      record({
        syncState: 'active',
        writeCalendarId: null,
        lastPulledAt: new Date(now.getTime() - 60 * 1000).toISOString(),
      }),
    )
    await renderPage()
    expect(screen.getByTestId('teacher-bullet-write').textContent).toMatch(
      /Выберите календарь для записи/,
    )
    // conflict bullet still says works (post-pull, independent of push)
    expect(screen.getByTestId('teacher-bullet-conflicts').textContent).toMatch(
      /✓ Работает сейчас/,
    )
  })

  it('disconnected → dynamic bullets hidden', async () => {
    integrationMock.mockResolvedValue(record({ syncState: 'disconnected' }))
    await renderPage()
    expect(screen.queryByTestId('teacher-bullet-read')).toBeNull()
    expect(screen.queryByTestId('teacher-bullet-write')).toBeNull()
    expect(screen.queryByTestId('teacher-bullet-conflicts')).toBeNull()
  })

  it('active_stale → bullets visible with "может срабатывать с задержкой"', async () => {
    integrationMock.mockResolvedValue(
      record({
        syncState: 'active',
        lastPulledAt: new Date(now.getTime() - 15 * 60 * 1000).toISOString(),
      }),
    )
    await renderPage()
    expect(screen.getByTestId('teacher-bullet-read').textContent).toMatch(
      /может срабатывать с задержкой/,
    )
    expect(screen.getByTestId('teacher-bullet-conflicts').textContent).toMatch(
      /конфликты могут подсвечиваться с задержкой/,
    )
  })
})

describe('/teacher/settings/calendar — anti-regression', () => {
  it('page never contains banned word "слот" (case-insensitive)', async () => {
    integrationMock.mockResolvedValue(record({ syncState: 'active' }))
    await renderPage()
    const body = document.body.textContent ?? ''
    expect(body.toLowerCase()).not.toMatch(/слот/)
  })

  it('page never contains "токены" / "OAuth-токены"', async () => {
    integrationMock.mockResolvedValue(record({ syncState: 'active' }))
    await renderPage()
    const body = document.body.textContent ?? ''
    expect(body).not.toMatch(/токены/i)
  })

  it('page never says "Реальные синхронизации событий — следующие шаги"', async () => {
    integrationMock.mockResolvedValue(record({ syncState: 'active' }))
    await renderPage()
    const body = document.body.textContent ?? ''
    expect(body).not.toMatch(/Реальные синхронизации событий — следующие шаги/)
  })

  it('page never says "по мере включения"', async () => {
    integrationMock.mockResolvedValue(record({ syncState: 'active' }))
    await renderPage()
    const body = document.body.textContent ?? ''
    expect(body).not.toMatch(/по мере включения/)
  })
})
