// @vitest-environment jsdom

// 2026-06-17 cabinet-settings-calendar-copy: страница свернула
// pull/push-копи в одну консолидированную строку статуса. Старый
// matrix (10 случаев × pull + 4 × push + 3 cross-axis) заменён на
// семантическую матрицу по 6 состояниям + footer + anti-teaser.
//
// Прежний plan: docs/plans/cabinet-stale-future-labels.md §D.

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

const STATUS_COPY = {
  healthy:
    'Google Calendar учителя подключён. Занятое в нём время автоматически скрывается из расписания, а ваши брони сразу попадают учителю в календарь.',
  no_integration:
    'Расписание ведётся внутри LevelChannel. Внешний календарь учителю подключать не обязательно — бронирование занятий работает напрямую через сайт.',
  disconnected:
    'Google Calendar учителя сейчас отключён. На бронирование занятий это не влияет — расписание ведётся в LevelChannel.',
  degraded:
    'Google Calendar учителя подключён, но синхронизация сейчас отстаёт. Это временно — бронирование занятий продолжает работать.',
  read_only:
    'Google Calendar учителя подключён только на чтение. Занятое в нём время скрывается, но брони пока не попадают в его календарь автоматически.',
  mixed:
    'Google Calendar учителя в смешанном состоянии. Бронирование занятий продолжает работать через LevelChannel.',
}

describe('/cabinet/settings/calendar — combined status copy', () => {
  it('healthy: active_fresh + works → green dot + healthy copy', async () => {
    integrationMock.mockResolvedValue(
      record({
        syncState: 'active',
        writeCalendarId: 'primary',
        lastPulledAt: new Date(now.getTime() - 60 * 1000).toISOString(),
      }),
    )
    await renderPage()
    expect(screen.getByTestId('calendar-status-copy').textContent).toBe(
      STATUS_COPY.healthy,
    )
  })

  it('no_integration → idle copy without Google Calendar mention as dependency', async () => {
    integrationMock.mockResolvedValue(null)
    await renderPage()
    expect(screen.getByTestId('calendar-status-copy').textContent).toBe(
      STATUS_COPY.no_integration,
    )
  })

  it('disconnected (both axes) → idle copy', async () => {
    integrationMock.mockResolvedValue(
      record({ syncState: 'disconnected', writeCalendarId: 'primary' }),
    )
    await renderPage()
    expect(screen.getByTestId('calendar-status-copy').textContent).toBe(
      STATUS_COPY.disconnected,
    )
  })

  it('active_stale → warn copy', async () => {
    integrationMock.mockResolvedValue(
      record({
        syncState: 'active',
        writeCalendarId: 'primary',
        lastPulledAt: new Date(now.getTime() - 15 * 60 * 1000).toISOString(),
      }),
    )
    await renderPage()
    expect(screen.getByTestId('calendar-status-copy').textContent).toBe(
      STATUS_COPY.degraded,
    )
  })

  it('degraded → warn copy', async () => {
    integrationMock.mockResolvedValue(
      record({ syncState: 'degraded', writeCalendarId: 'primary' }),
    )
    await renderPage()
    expect(screen.getByTestId('calendar-status-copy').textContent).toBe(
      STATUS_COPY.degraded,
    )
  })

  it('active_fresh + no_write_calendar → read-only copy', async () => {
    integrationMock.mockResolvedValue(
      record({
        syncState: 'active',
        writeCalendarId: null,
        lastPulledAt: new Date(now.getTime() - 60 * 1000).toISOString(),
      }),
    )
    await renderPage()
    expect(screen.getByTestId('calendar-status-copy').textContent).toBe(
      STATUS_COPY.read_only,
    )
  })
})

describe('/cabinet/settings/calendar — footer (operator master switch)', () => {
  it('switch ON → "✓ Email-напоминания приходят перед занятиями."', async () => {
    operatorMock.mockResolvedValue({
      LEARNER_REMINDERS_EMAIL_ENABLED: { value: 1 },
    })
    await renderPage()
    expect(screen.getByTestId('calendar-reminder-footer').textContent).toBe(
      '✓ Email-напоминания приходят перед занятиями.',
    )
  })

  it('switch OFF → "Email-напоминания временно выключены оператором."', async () => {
    operatorMock.mockResolvedValue({
      LEARNER_REMINDERS_EMAIL_ENABLED: { value: 0 },
    })
    await renderPage()
    expect(screen.getByTestId('calendar-reminder-footer').textContent).toBe(
      'Email-напоминания временно выключены оператором.',
    )
  })
})

describe('/cabinet/settings/calendar — anti-teaser regression', () => {
  it('page never says "Добавим следующими версиями" or "слот"', async () => {
    operatorMock.mockResolvedValue({
      LEARNER_REMINDERS_EMAIL_ENABLED: { value: 1 },
    })
    integrationMock.mockResolvedValue(record({ syncState: 'active' }))
    await renderPage()
    const body = document.body.textContent ?? ''
    expect(body).not.toMatch(/Добавим следующими версиями/)
    expect(body).not.toMatch(/в работе/)
    expect(body).not.toMatch(/следующих обновлений/)
    expect(body.toLowerCase()).not.toMatch(/слот/)
  })

  it('no_integration: copy is friendly, no «не подключал» phrasing', async () => {
    // Owner-feedback 2026-06-17: «странные текста про гугл календарь и
    // не включенная интеграция» — старый pull-copy буквально начинался
    // с «Учитель пока не подключал Google Calendar», что подсвечивало
    // отсутствие функции вместо того, чтобы успокоить пользователя.
    // Новый copy не должен начинаться с обвинения «учитель не…».
    integrationMock.mockResolvedValue(null)
    await renderPage()
    const text = screen.getByTestId('calendar-status-copy').textContent ?? ''
    expect(text).not.toMatch(/пока не подключал/)
  })
})
