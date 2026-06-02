// @vitest-environment jsdom

// Plan: docs/plans/cabinet-stale-future-labels.md §D.
// Renders /cabinet/settings/calendar across the (pullStatus × pushStatus)
// matrix and the operator master switch to pin exact copy per state and
// prevent silent drift between spec and rendered text.
//
// Location under tests/cabinet/ matches the .tsx-friendly default vitest
// pool (integration runner only includes *.test.ts).

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
    account: {
      id: 'learner-account-fixture',
      assignedTeacherId: 'teacher-fixture',
    },
  })),
}))

vi.mock('@/lib/auth/accounts', () => ({
  listAccountRoles: vi.fn(async () => ['student']),
}))

vi.mock('@/lib/auth/teacher-scope', () => ({
  getActiveTeacherForLearner: vi.fn(async () => ({
    teacherId: 'teacher-fixture',
  })),
}))

const integrationMock = vi.fn<
  () => Promise<TeacherCalendarIntegrationRecord | null>
>(async () => null)
vi.mock('@/lib/calendar/integrations', () => ({
  getGoogleIntegrationMeta: () => integrationMock(),
}))

const operatorMock = vi.fn<() => Promise<Record<string, { value: number }>>>(
  async () => ({ LEARNER_REMINDERS_EMAIL_ENABLED: { value: 0 } }),
)
vi.mock('@/lib/admin/operator-settings', () => ({
  resolveOperatorSettingsForProbe: () => operatorMock(),
}))

// Light AuthShell stub — render children directly so we can find DOM.
vi.mock('@/components/auth-shell', () => ({
  AuthShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

import LearnerCalendarSettingsPage from '@/app/cabinet/settings/calendar/page'

const now = new Date('2026-06-02T12:00:00Z')

function record(
  overrides: Partial<TeacherCalendarIntegrationRecord> = {},
): TeacherCalendarIntegrationRecord {
  return {
    accountId: 'teacher-fixture',
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
  operatorMock.mockReset()
  operatorMock.mockResolvedValue({
    LEARNER_REMINDERS_EMAIL_ENABLED: { value: 0 },
  })
})

async function renderPage() {
  const jsx = await LearnerCalendarSettingsPage()
  render(jsx)
}

describe('/cabinet/settings/calendar — pull-axis copy', () => {
  it('no_integration → "Учитель пока не подключал Google Calendar"', async () => {
    integrationMock.mockResolvedValue(null)
    await renderPage()
    expect(screen.getByTestId('calendar-pull-copy').textContent).toMatch(
      /Учитель пока не подключал Google Calendar/,
    )
  })

  it('disconnected → "Учитель отключил Google Calendar"', async () => {
    integrationMock.mockResolvedValue(record({ syncState: 'disconnected' }))
    await renderPage()
    expect(screen.getByTestId('calendar-pull-copy').textContent).toMatch(
      /Учитель отключил Google Calendar/,
    )
  })

  it('active_fresh → "✓ Работает сейчас"', async () => {
    integrationMock.mockResolvedValue(
      record({
        syncState: 'active',
        lastPulledAt: new Date(now.getTime() - 60 * 1000).toISOString(),
      }),
    )
    await renderPage()
    expect(screen.getByTestId('calendar-pull-copy').textContent).toMatch(
      /✓ Работает сейчас/,
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
    expect(screen.getByTestId('calendar-pull-copy').textContent).toMatch(
      /синхронизация сейчас отстаёт/,
    )
  })

  it('degraded → "Google сейчас отвечает с ошибками"', async () => {
    integrationMock.mockResolvedValue(record({ syncState: 'degraded' }))
    await renderPage()
    expect(screen.getByTestId('calendar-pull-copy').textContent).toMatch(
      /Google сейчас отвечает с ошибками/,
    )
  })
})

describe('/cabinet/settings/calendar — push-axis copy', () => {
  it('works → "бронь сразу появляется"', async () => {
    integrationMock.mockResolvedValue(record({ writeCalendarId: 'primary' }))
    await renderPage()
    expect(screen.getByTestId('calendar-push-copy').textContent).toMatch(
      /бронь сразу появляется у учителя в Google Calendar/,
    )
  })

  it('no_write_calendar → "учитель пока не выбрал, в какой календарь писать"', async () => {
    integrationMock.mockResolvedValue(
      record({ syncState: 'active', writeCalendarId: null }),
    )
    await renderPage()
    expect(screen.getByTestId('calendar-push-copy').textContent).toMatch(
      /учитель пока не выбрал, в какой календарь писать/,
    )
  })

  it('disconnected → "учитель отключил интеграцию"', async () => {
    integrationMock.mockResolvedValue(
      record({ syncState: 'disconnected', writeCalendarId: 'primary' }),
    )
    await renderPage()
    expect(screen.getByTestId('calendar-push-copy').textContent).toMatch(
      /учитель отключил интеграцию/,
    )
  })

  it('no_integration → "учитель пока не подключал Google Calendar"', async () => {
    integrationMock.mockResolvedValue(null)
    await renderPage()
    expect(screen.getByTestId('calendar-push-copy').textContent).toMatch(
      /учитель пока не подключал Google Calendar/,
    )
  })
})

describe('/cabinet/settings/calendar — footer', () => {
  it('operator switch ON → "✓ Email-напоминания приходят перед занятиями."', async () => {
    operatorMock.mockResolvedValue({
      LEARNER_REMINDERS_EMAIL_ENABLED: { value: 1 },
    })
    await renderPage()
    expect(screen.getByTestId('calendar-reminder-footer').textContent).toBe(
      '✓ Email-напоминания приходят перед занятиями.',
    )
  })

  it('operator switch OFF → "Email-напоминания временно выключены оператором."', async () => {
    operatorMock.mockResolvedValue({
      LEARNER_REMINDERS_EMAIL_ENABLED: { value: 0 },
    })
    await renderPage()
    expect(screen.getByTestId('calendar-reminder-footer').textContent).toBe(
      'Email-напоминания временно выключены оператором.',
    )
  })

  it('anti-teaser regression — footer never says "Добавим следующими версиями"', async () => {
    operatorMock.mockResolvedValue({
      LEARNER_REMINDERS_EMAIL_ENABLED: { value: 1 },
    })
    await renderPage()
    const footerText =
      screen.getByTestId('calendar-reminder-footer').textContent ?? ''
    expect(footerText).not.toMatch(/Добавим следующими версиями/)
    expect(footerText).not.toMatch(/в работе/)
    expect(footerText).not.toMatch(/следующих обновлений/)
  })

  it('anti-teaser regression — page never says "слот" (case-insensitive)', async () => {
    integrationMock.mockResolvedValue(record({ syncState: 'active' }))
    await renderPage()
    const body = document.body.textContent ?? ''
    expect(body.toLowerCase()).not.toMatch(/слот/)
  })
})

describe('/cabinet/settings/calendar — cross-axis permutations', () => {
  it('active_fresh + works → golden state, both copy strings positive', async () => {
    integrationMock.mockResolvedValue(
      record({
        syncState: 'active',
        writeCalendarId: 'primary',
        lastPulledAt: new Date(now.getTime() - 60 * 1000).toISOString(),
      }),
    )
    await renderPage()
    expect(screen.getByTestId('calendar-pull-copy').textContent).toMatch(
      /✓ Работает сейчас/,
    )
    expect(screen.getByTestId('calendar-push-copy').textContent).toMatch(
      /бронь сразу появляется/,
    )
  })

  it('active_fresh + no_write_calendar → pull healthy, push not', async () => {
    integrationMock.mockResolvedValue(
      record({
        syncState: 'active',
        writeCalendarId: null,
        lastPulledAt: new Date(now.getTime() - 60 * 1000).toISOString(),
      }),
    )
    await renderPage()
    expect(screen.getByTestId('calendar-pull-copy').textContent).toMatch(
      /✓ Работает сейчас/,
    )
    expect(screen.getByTestId('calendar-push-copy').textContent).toMatch(
      /учитель пока не выбрал, в какой календарь писать/,
    )
  })

  it('no_integration → both axes consistent ("пока не подключал")', async () => {
    integrationMock.mockResolvedValue(null)
    await renderPage()
    expect(screen.getByTestId('calendar-pull-copy').textContent).toMatch(
      /Учитель пока не подключал Google Calendar/,
    )
    expect(screen.getByTestId('calendar-push-copy').textContent).toMatch(
      /учитель пока не подключал Google Calendar/,
    )
  })
})
