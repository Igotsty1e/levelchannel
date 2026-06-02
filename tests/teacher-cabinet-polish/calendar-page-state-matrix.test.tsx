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

describe('/teacher/settings/calendar — intro copy by (pull × push), exact-match pins', () => {
  const ACTIVE_FRESH_WORKS_COPY =
    'Подключите ваш Google Calendar — мы учитываем вашу занятость в расписании и записываем туда же забронированные занятия. ✓ Работает сейчас.'
  const ACTIVE_FRESH_NO_WRITE_COPY =
    'Подключение установлено: занятость учитывается. Выберите календарь для записи занятий в настройках выше.'
  const ACTIVE_STALE_COPY =
    'Подключение установлено, но синхронизация сейчас отстаёт. Восстановится автоматически — мы повторим запрос через минуту.'
  const DEGRADED_COPY =
    'Подключение установлено, но Google сейчас отвечает с ошибками. Учитываем последние известные занятия — синхронизация восстановится автоматически.'
  const DISCONNECTED_COPY =
    'Интеграция отключена. Расписание не учитывает занятия из вашего Google Calendar. Подключитесь снова, чтобы возобновить синхронизацию.'
  const NO_INTEGRATION_COPY =
    'Подключите ваш Google Calendar — мы будем учитывать вашу занятость в расписании и записывать туда же забронированные занятия.'

  it('active_fresh + works → exact golden copy', async () => {
    integrationMock.mockResolvedValue(
      record({
        syncState: 'active',
        writeCalendarId: 'primary',
        lastPulledAt: new Date(now.getTime() - 60 * 1000).toISOString(),
      }),
    )
    await renderPage()
    expect(screen.getByTestId('teacher-calendar-intro').textContent).toBe(
      ACTIVE_FRESH_WORKS_COPY,
    )
  })

  it('active_fresh + no_write_calendar → exact pull-healthy, push-broken copy', async () => {
    integrationMock.mockResolvedValue(
      record({
        syncState: 'active',
        writeCalendarId: null,
        lastPulledAt: new Date(now.getTime() - 60 * 1000).toISOString(),
      }),
    )
    await renderPage()
    expect(screen.getByTestId('teacher-calendar-intro').textContent).toBe(
      ACTIVE_FRESH_NO_WRITE_COPY,
    )
  })

  it('active_stale → exact stale copy', async () => {
    integrationMock.mockResolvedValue(
      record({
        syncState: 'active',
        lastPulledAt: new Date(now.getTime() - 15 * 60 * 1000).toISOString(),
      }),
    )
    await renderPage()
    expect(screen.getByTestId('teacher-calendar-intro').textContent).toBe(
      ACTIVE_STALE_COPY,
    )
  })

  it('degraded → exact degraded copy (distinct from stale)', async () => {
    integrationMock.mockResolvedValue(record({ syncState: 'degraded' }))
    await renderPage()
    expect(screen.getByTestId('teacher-calendar-intro').textContent).toBe(
      DEGRADED_COPY,
    )
  })

  it('no_integration → exact CTA copy (no teaser)', async () => {
    integrationMock.mockResolvedValue(null)
    await renderPage()
    expect(screen.getByTestId('teacher-calendar-intro').textContent).toBe(
      NO_INTEGRATION_COPY,
    )
  })

  it('disconnected → exact "Интеграция отключена" copy (distinct from no_integration)', async () => {
    integrationMock.mockResolvedValue(record({ syncState: 'disconnected' }))
    await renderPage()
    expect(screen.getByTestId('teacher-calendar-intro').textContent).toBe(
      DISCONNECTED_COPY,
    )
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

  const BULLET_READ_FRESH =
    'Читаем события из вашего календаря в окне «сегодня → +30 дней». Если на это время уже что-то запланировано, ваше свободное время в LevelChannel перестаёт показываться ученику — пока вы не освободите время в Google. ✓ Работает сейчас.'
  const BULLET_READ_STALE =
    'Читаем события из вашего календаря в окне «сегодня → +30 дней». Если на это время уже что-то запланировано, ваше свободное время в LevelChannel перестаёт показываться ученику — пока вы не освободите время в Google. Сейчас синхронизация отстаёт — может срабатывать с задержкой.'
  const BULLET_WRITE_WORKS =
    'Записываем каждое забронированное занятие в ваш календарь как обычное событие «LC: имя ученика, 19:00–19:50». Удалите его в Google — мы покажем баннер «вы удалили занятие, отменить его в LevelChannel?». ✓ Работает сейчас.'
  const BULLET_WRITE_NO_CAL =
    'Записываем каждое забронированное занятие в ваш календарь как обычное событие «LC: имя ученика, 19:00–19:50». Удалите его в Google — мы покажем баннер «вы удалили занятие, отменить его в LevelChannel?». Выберите календарь для записи в настройках выше.'
  const BULLET_CONFLICTS_FRESH =
    'Конфликты (вы создали другую встречу поверх уже забронированного занятия) мы видим и подсвечиваем красным на главной — вы решаете вручную: отменить занятие, перенести его или удалить чужое событие в Google. ✓ Работает сейчас.'
  const BULLET_CONFLICTS_STALE =
    'Конфликты (вы создали другую встречу поверх уже забронированного занятия) мы видим и подсвечиваем красным на главной — вы решаете вручную: отменить занятие, перенести его или удалить чужое событие в Google. Сейчас синхронизация отстаёт — конфликты могут подсвечиваться с задержкой.'

  // textContent normalises whitespace from JSX literal but preserves the strong-tag
  // children with a leading space — match the rendered shape exactly.
  function readBullet() {
    return (
      screen.getByTestId('teacher-bullet-read').textContent ?? ''
    ).replace(/\s+/g, ' ').trim()
  }
  function writeBullet() {
    return (
      screen.getByTestId('teacher-bullet-write').textContent ?? ''
    ).replace(/\s+/g, ' ').trim()
  }
  function conflictBullet() {
    return (
      screen.getByTestId('teacher-bullet-conflicts').textContent ?? ''
    ).replace(/\s+/g, ' ').trim()
  }

  it('active_fresh + works → all 3 dynamic bullets exact-match the "works now" copies', async () => {
    integrationMock.mockResolvedValue(
      record({
        syncState: 'active',
        writeCalendarId: 'primary',
        lastPulledAt: new Date(now.getTime() - 60 * 1000).toISOString(),
      }),
    )
    await renderPage()
    expect(readBullet()).toBe(BULLET_READ_FRESH)
    expect(writeBullet()).toBe(BULLET_WRITE_WORKS)
    expect(conflictBullet()).toBe(BULLET_CONFLICTS_FRESH)
  })

  it('active_fresh + no_write_calendar → write bullet exact-match "no calendar" copy; conflict still works (independent axes)', async () => {
    integrationMock.mockResolvedValue(
      record({
        syncState: 'active',
        writeCalendarId: null,
        lastPulledAt: new Date(now.getTime() - 60 * 1000).toISOString(),
      }),
    )
    await renderPage()
    expect(writeBullet()).toBe(BULLET_WRITE_NO_CAL)
    expect(conflictBullet()).toBe(BULLET_CONFLICTS_FRESH)
  })

  it('disconnected → dynamic bullets hidden', async () => {
    integrationMock.mockResolvedValue(record({ syncState: 'disconnected' }))
    await renderPage()
    expect(screen.queryByTestId('teacher-bullet-read')).toBeNull()
    expect(screen.queryByTestId('teacher-bullet-write')).toBeNull()
    expect(screen.queryByTestId('teacher-bullet-conflicts')).toBeNull()
  })

  it('active_stale → read + conflict bullets exact-match stale copies', async () => {
    integrationMock.mockResolvedValue(
      record({
        syncState: 'active',
        lastPulledAt: new Date(now.getTime() - 15 * 60 * 1000).toISOString(),
      }),
    )
    await renderPage()
    expect(readBullet()).toBe(BULLET_READ_STALE)
    expect(conflictBullet()).toBe(BULLET_CONFLICTS_STALE)
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
