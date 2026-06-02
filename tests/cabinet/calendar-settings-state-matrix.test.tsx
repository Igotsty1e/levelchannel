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

const PULL_COPY = {
  no_integration:
    'Учитель пока не подключал Google Calendar. Время в расписании показывается как есть, без проверки занятости в чужом календаре.',
  disconnected:
    'Учитель отключил Google Calendar. Время в расписании показывается как есть.',
  active_fresh:
    'Когда учитель занят в Google Calendar другим делом, эти занятия автоматически исчезают из расписания — вы не сможете записаться на занятое время. ✓ Работает сейчас.',
  active_stale:
    'Учитель подключил Google Calendar, но синхронизация сейчас отстаёт. Пока синхронизация не восстановится, занятое в Google время может не скрываться автоматически.',
  degraded:
    'Учитель подключил Google Calendar, но Google сейчас отвечает с ошибками. Пока ошибки не пройдут, занятое в Google время может не скрываться автоматически.',
}

const PUSH_COPY = {
  works:
    'Когда вы записываетесь, бронь сразу появляется у учителя в Google Calendar.',
  no_write_calendar:
    'Бронь у учителя в Google Calendar не появится: учитель пока не выбрал, в какой календарь писать.',
  disconnected:
    'Бронь у учителя в Google Calendar не появится: учитель отключил интеграцию.',
  no_integration:
    'Бронь у учителя в Google Calendar не появится: учитель пока не подключал Google Calendar.',
}

describe('/cabinet/settings/calendar — pull-axis copy (exact-match)', () => {
  it('no_integration', async () => {
    integrationMock.mockResolvedValue(null)
    await renderPage()
    expect(screen.getByTestId('calendar-pull-copy').textContent).toBe(
      PULL_COPY.no_integration,
    )
  })

  it('disconnected', async () => {
    integrationMock.mockResolvedValue(record({ syncState: 'disconnected' }))
    await renderPage()
    expect(screen.getByTestId('calendar-pull-copy').textContent).toBe(
      PULL_COPY.disconnected,
    )
  })

  it('active_fresh', async () => {
    integrationMock.mockResolvedValue(
      record({
        syncState: 'active',
        lastPulledAt: new Date(now.getTime() - 60 * 1000).toISOString(),
      }),
    )
    await renderPage()
    expect(screen.getByTestId('calendar-pull-copy').textContent).toBe(
      PULL_COPY.active_fresh,
    )
  })

  it('active_stale', async () => {
    integrationMock.mockResolvedValue(
      record({
        syncState: 'active',
        lastPulledAt: new Date(now.getTime() - 15 * 60 * 1000).toISOString(),
      }),
    )
    await renderPage()
    expect(screen.getByTestId('calendar-pull-copy').textContent).toBe(
      PULL_COPY.active_stale,
    )
  })

  it('degraded', async () => {
    integrationMock.mockResolvedValue(record({ syncState: 'degraded' }))
    await renderPage()
    expect(screen.getByTestId('calendar-pull-copy').textContent).toBe(
      PULL_COPY.degraded,
    )
  })
})

describe('/cabinet/settings/calendar — push-axis copy (exact-match)', () => {
  it('works', async () => {
    integrationMock.mockResolvedValue(record({ writeCalendarId: 'primary' }))
    await renderPage()
    expect(screen.getByTestId('calendar-push-copy').textContent).toBe(
      PUSH_COPY.works,
    )
  })

  it('no_write_calendar', async () => {
    integrationMock.mockResolvedValue(
      record({ syncState: 'active', writeCalendarId: null }),
    )
    await renderPage()
    expect(screen.getByTestId('calendar-push-copy').textContent).toBe(
      PUSH_COPY.no_write_calendar,
    )
  })

  it('disconnected', async () => {
    integrationMock.mockResolvedValue(
      record({ syncState: 'disconnected', writeCalendarId: 'primary' }),
    )
    await renderPage()
    expect(screen.getByTestId('calendar-push-copy').textContent).toBe(
      PUSH_COPY.disconnected,
    )
  })

  it('no_integration', async () => {
    integrationMock.mockResolvedValue(null)
    await renderPage()
    expect(screen.getByTestId('calendar-push-copy').textContent).toBe(
      PUSH_COPY.no_integration,
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
  it('active_fresh + works → golden state, exact copy both axes', async () => {
    integrationMock.mockResolvedValue(
      record({
        syncState: 'active',
        writeCalendarId: 'primary',
        lastPulledAt: new Date(now.getTime() - 60 * 1000).toISOString(),
      }),
    )
    await renderPage()
    expect(screen.getByTestId('calendar-pull-copy').textContent).toBe(
      PULL_COPY.active_fresh,
    )
    expect(screen.getByTestId('calendar-push-copy').textContent).toBe(
      PUSH_COPY.works,
    )
  })

  it('active_fresh + no_write_calendar → pull healthy, push broken (independent axes)', async () => {
    integrationMock.mockResolvedValue(
      record({
        syncState: 'active',
        writeCalendarId: null,
        lastPulledAt: new Date(now.getTime() - 60 * 1000).toISOString(),
      }),
    )
    await renderPage()
    expect(screen.getByTestId('calendar-pull-copy').textContent).toBe(
      PULL_COPY.active_fresh,
    )
    expect(screen.getByTestId('calendar-push-copy').textContent).toBe(
      PUSH_COPY.no_write_calendar,
    )
  })

  it('no_integration → both axes consistent (exact strings)', async () => {
    integrationMock.mockResolvedValue(null)
    await renderPage()
    expect(screen.getByTestId('calendar-pull-copy').textContent).toBe(
      PULL_COPY.no_integration,
    )
    expect(screen.getByTestId('calendar-push-copy').textContent).toBe(
      PUSH_COPY.no_integration,
    )
  })
})
