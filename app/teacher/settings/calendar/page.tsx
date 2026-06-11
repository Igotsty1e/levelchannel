import { cookies } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { getAccountProfile } from '@/lib/auth/profiles'
import { SESSION_COOKIE_NAME, lookupSession } from '@/lib/auth/sessions'
import {
  derivePullStatus,
  derivePushStatus,
  type PullStatus,
  type PushStatus,
} from '@/lib/calendar/derive-status'
import { getGoogleCalendarOauthConfig } from '@/lib/calendar/google/config'
import { getGoogleIntegrationMeta } from '@/lib/calendar/integrations'
import { listOrphanSelfSlotsForTeacher } from '@/lib/calendar/orphan-cleanup'

import { getCalendarSlotMode } from '@/lib/scheduling/slot-mode'

import { CalendarConnectCard } from './connect-card'
import { OrphanSection } from './orphan-section'
import { SlotModeToggle } from './slot-mode-toggle'

// BCS-C.4 + C.6 — teacher's Google Calendar settings page.
//
// Wraps the OAuth start/disconnect routes with plain-language copy
// that explains what the integration actually does, what gets pushed
// to Google, what stays on LevelChannel, and what happens when the
// teacher disconnects.
//
// Auth is enforced by app/teacher/layout.tsx (teacher-verified gate);
// this page can assume the cookie session resolves to a teacher.

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const metadata = {
  title: 'Календарь — настройки учителя — LevelChannel',
}

type SearchParams = Record<string, string | string[] | undefined>

function paramString(
  v: string | string[] | undefined,
  defaultValue: string | null = null,
): string | null {
  if (!v) return defaultValue
  if (Array.isArray(v)) return v[0] ?? defaultValue
  return v
}

function teacherIntroCopy(pull: PullStatus, push: PushStatus): string {
  if (pull === 'active_fresh' && push === 'works') {
    return 'Подключите ваш Google Calendar — мы учитываем вашу занятость в расписании и записываем туда же забронированные занятия. ✓ Работает сейчас.'
  }
  if (pull === 'active_fresh' && push === 'no_write_calendar') {
    return 'Подключение установлено: занятость учитывается. Выберите календарь для записи занятий в настройках выше.'
  }
  if (pull === 'active_stale') {
    return 'Подключение установлено, но синхронизация сейчас отстаёт. Восстановится автоматически — мы повторим запрос через минуту.'
  }
  if (pull === 'degraded') {
    return 'Подключение установлено, но Google сейчас отвечает с ошибками. Учитываем последние известные занятия — синхронизация восстановится автоматически.'
  }
  if (pull === 'disconnected') {
    return 'Интеграция отключена. Расписание не учитывает занятия из вашего Google Calendar. Подключитесь снова, чтобы возобновить синхронизацию.'
  }
  // no_integration
  return 'Подключите ваш Google Calendar — мы будем учитывать вашу занятость в расписании и записывать туда же забронированные занятия.'
}

function bullet1Suffix(pull: PullStatus): string | null {
  if (pull === 'no_integration' || pull === 'disconnected') return null
  if (pull === 'active_fresh') return '✓ Работает сейчас.'
  return 'Сейчас синхронизация отстаёт — может срабатывать с задержкой.'
}

function bullet2Suffix(push: PushStatus): string | null {
  if (push === 'no_integration' || push === 'disconnected') return null
  if (push === 'works') return '✓ Работает сейчас.'
  return 'Выберите календарь для записи в настройках выше.'
}

function bullet3Suffix(pull: PullStatus): string | null {
  if (pull === 'no_integration' || pull === 'disconnected') return null
  if (pull === 'active_fresh') return '✓ Работает сейчас.'
  return 'Сейчас синхронизация отстаёт — конфликты могут подсвечиваться с задержкой.'
}

// 2026-06-05 calendar-onboarding-cleanup — localized error map. The
// callback redirects with stable error codes; we render plain Russian
// (no «токен / OAuth / refresh-token» jargon — docs/content-style.md
// §forbidden).
const ERROR_MESSAGES: Record<string, string> = {
  timezone_required:
    'Укажите часовой пояс в профиле и нажмите «Сохранить» — без него календарь не подключается.',
  consent_denied: 'Вы отменили разрешение на стороне Google. Попробуйте подключиться ещё раз.',
  invalid_callback: 'Google вернул некорректный ответ. Попробуйте подключиться ещё раз.',
  state_invalid: 'Срок действия запроса истёк. Попробуйте подключиться ещё раз.',
  wrong_role: 'Аккаунт не имеет роли учителя.',
  email_unverified: 'Подтвердите адрес почты перед подключением календаря.',
  saas_offer_awaiting_publication:
    'Подключение временно недоступно — оператор обновляет соглашение.',
  saas_offer_consent_required: 'Подтвердите соглашение перед подключением.',
  token_exchange_failed:
    'Не удалось подтвердить вход в Google. Проверьте часы устройства и попробуйте ещё раз.',
  no_refresh_token:
    'Google не выдал нужное разрешение. Нажмите «Подключить» ещё раз и подтвердите все запрашиваемые доступы.',
  persist_failed: 'Не удалось сохранить подключение. Попробуйте ещё раз.',
  oauth_misconfigured: 'Подключение календаря пока недоступно — напишите оператору.',
  oauth_not_configured: 'Подключение календаря пока недоступно — напишите оператору.',
  rate_limited: 'Слишком много попыток подключения. Подождите минуту.',
}

export default async function TeacherCalendarSettingsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const params = await searchParams
  const connected = paramString(params.connected)
  const error = paramString(params.error)
  // 2026-06-05 calendar-onboarding-cleanup: callback's ?reason/?detail/?kind
  // tail params used to be surfaced raw in <code>. Now we render only the
  // localized message keyed by ?error= via ERROR_MESSAGES. The tail params
  // are still emitted by the callback (operator logs / Sentry breadcrumbs).

  const cookieStore = await cookies()
  const cookieValue = cookieStore.get(SESSION_COOKIE_NAME)?.value ?? null
  if (!cookieValue) redirect('/login')
  const session = await lookupSession(cookieValue)
  if (!session) redirect('/login')

  // Either may throw in prod when env is missing — that's intentional
  // boot guard, but on the settings page we want to render the
  // diagnostic instead of crashing.
  //
  // TASK-6 (teacher-cabinet-polish sub-PR A): the DOM no longer exposes
  // configError to the teacher (just a neutral "Скоро будет" tile). We
  // still log the raw error server-side so ops can diagnose env drift
  // from logs without depending on a teacher hitting "Подробнее".
  let configReady = false
  let configError: string | null = null
  try {
    configReady = getGoogleCalendarOauthConfig() !== null
  } catch (e) {
    configError = e instanceof Error ? e.message : String(e)
    console.error(
      '[teacher/settings/calendar] getGoogleCalendarOauthConfig threw',
      { error: configError },
    )
  }

  const integration = await getGoogleIntegrationMeta(session.account.id)
  const isConnected = integration?.syncState === 'active'
    || integration?.syncState === 'degraded'
  const pullStatus = derivePullStatus(integration)
  const pushStatus = derivePushStatus(integration)

  // 2026-06-05 calendar-onboarding-cleanup — timezone gate (TASK #8).
  // Without a saved timezone the calendar pull/push workers fall back
  // to MSK via safeTimezone; non-MSK teachers get silent misrender.
  // Refuse to start OAuth and surface a banner pointing at the profile
  // editor. Gate is also enforced server-side (start route + callback)
  // for defense-in-depth.
  const profile = await getAccountProfile(session.account.id)
  const timezoneNotSet = profile?.timezone == null

  // BCS-G.4 — orphan-self slots (stale binding from a prior epoch).
  // Surfaced when present so the teacher can clear the local link.
  const orphanSlots = await listOrphanSelfSlotsForTeacher(session.account.id)
  const slotMode = await getCalendarSlotMode(session.account.id)

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '24px 16px' }}>
      <Link
        href="/teacher"
        style={{
          color: 'var(--secondary)',
          fontSize: 13,
          textDecoration: 'none',
        }}
      >
        ← В учительский кабинет
      </Link>

      <h1
        style={{
          fontSize: 28,
          fontWeight: 700,
          margin: '16px 0 8px 0',
        }}
      >
        Синхронизация с Google Calendar
      </h1>
      {/* TASK-6 (teacher-cabinet-polish sub-PR A) — page-level intro
          and CTA gate on configReady. When env is missing (configError
          or !configReady) we suppress the contradictory "подключение
          готово / Подключитесь сейчас" copy and show a single neutral
          "Эта функция активируется" line above the connect-card's
          "Скоро будет" tile. When configReady flips to true, the
          original intro + CTA are restored without a second deploy. */}
      {configReady ? (
        <p
          data-testid="teacher-calendar-intro"
          style={{
            color: 'var(--secondary)',
            fontSize: 15,
            margin: '0 0 24px 0',
            lineHeight: 1.6,
          }}
        >
          {teacherIntroCopy(pullStatus, pushStatus)}
        </p>
      ) : (
        <p
          data-testid="calendar-coming-soon-intro"
          style={{
            color: 'var(--secondary)',
            fontSize: 15,
            margin: '0 0 24px 0',
            lineHeight: 1.6,
          }}
        >
          Эта функция активируется в ближайшем обновлении. Спасибо за
          терпение.
        </p>
      )}

      {timezoneNotSet && !isConnected && configReady ? (
        <div
          role="alert"
          data-testid="teacher-calendar-timezone-gate"
          style={{
            padding: '12px 16px',
            background: 'var(--warning-bg)',
            color: 'var(--text-primary)',
            border: '1px solid var(--warning)',
            borderRadius: 8,
            margin: '0 0 16px 0',
            fontSize: 14,
            lineHeight: 1.6,
          }}
        >
          <p style={{ margin: '0 0 6px 0' }}>
            Укажите часовой пояс перед подключением — без него расписание
            учеников и события в Google Calendar могут уехать на чужое время.
          </p>
          <Link
            href="/teacher/profile"
            style={{ color: 'var(--warning)', textDecoration: 'underline' }}
          >
            Перейти в Профиль → выбрать пояс → нажать «Сохранить» →
          </Link>
        </div>
      ) : null}

      {connected === '1' ? (
        <p
          role="status"
          style={{
            padding: '12px 16px',
            background: 'rgba(155,223,155,0.15)',
            color: '#9bdf9b',
            borderRadius: 8,
            margin: '0 0 16px 0',
            fontSize: 14,
          }}
        >
          ✓ Google Calendar подключён. Расписание начнёт обновляться в течение
          нескольких минут.
        </p>
      ) : null}

      {error ? (
        <p
          role="alert"
          style={{
            padding: '12px 16px',
            background: 'rgba(255,138,138,0.12)',
            color: '#ffb0b0',
            borderRadius: 8,
            margin: '0 0 16px 0',
            fontSize: 14,
            lineHeight: 1.5,
          }}
        >
          ⚠ {ERROR_MESSAGES[error]
            ?? `Не удалось завершить подключение. Попробуйте ещё раз. Если повторяется, напишите оператору.`}
        </p>
      ) : null}

      <CalendarConnectCard
        configReady={configReady}
        configError={configError}
        isConnected={isConnected}
        syncState={integration?.syncState ?? null}
        lastReconnectedAt={integration?.lastReconnectedAt ?? null}
        timezoneNotSet={timezoneNotSet}
      />

      {/* 2026-06-05 calendar-onboarding-cleanup (TASK #11) — collapsed
          by default once integration is connected (teacher already knows
          how it works). Auto-expanded for not-yet-connected teachers so
          the explainer is the primary CTA below the connect card. */}
      <details
        open={!isConnected}
        style={{
          marginTop: 40,
          padding: 24,
          background: 'var(--surface-2, rgba(255,255,255,0.03))',
          border: '1px solid var(--border)',
          borderRadius: 12,
        }}
      >
        <summary
          data-testid="teacher-calendar-list-heading"
          style={{
            cursor: 'pointer',
            fontSize: 18,
            fontWeight: 600,
            margin: '0 0 12px 0',
            listStyle: 'revert',
          }}
        >
          Как работает интеграция с Google Calendar
        </summary>
        <ul
          style={{
            paddingLeft: 20,
            margin: 0,
            color: 'var(--secondary)',
            fontSize: 14,
            lineHeight: 1.7,
          }}
        >
          {bullet1Suffix(pullStatus) ? (
            <li data-testid="teacher-bullet-read">
              <strong style={{ color: 'var(--text)' }}>Читаем</strong>{' '}
              события из вашего календаря в окне «сегодня → +30 дней». Если
              на это время уже что-то запланировано, ваше свободное время в
              LevelChannel перестаёт показываться ученику — пока вы не
              освободите время в Google. {bullet1Suffix(pullStatus)}
            </li>
          ) : null}
          {bullet2Suffix(pushStatus) ? (
            <li data-testid="teacher-bullet-write">
              <strong style={{ color: 'var(--text)' }}>Записываем</strong>{' '}
              каждое забронированное занятие в ваш календарь как обычное
              событие «LC: имя ученика, 19:00–19:50». Удалите его в Google —
              мы покажем баннер «вы удалили занятие, отменить его в
              LevelChannel?». {bullet2Suffix(pushStatus)}
            </li>
          ) : null}
          {bullet3Suffix(pullStatus) ? (
            <li data-testid="teacher-bullet-conflicts">
              <strong style={{ color: 'var(--text)' }}>Конфликты</strong>{' '}
              (вы создали другую встречу поверх уже забронированного занятия)
              мы видим и подсвечиваем красным на главной — вы решаете
              вручную: отменить занятие, перенести его или удалить чужое
              событие в Google. {bullet3Suffix(pullStatus)}
            </li>
          ) : null}
          <li>
            <strong style={{ color: 'var(--text)' }}>Подключение</strong>{' '}
            даёт LevelChannel защищённый доступ к вашему календарю Google.
            Отозвать доступ — в любой момент кнопкой «Отключить».
          </li>
          <li>
            <strong style={{ color: 'var(--text)' }}>Отключение</strong>{' '}
            оставит события, которые мы успеем записать, в вашем Google.
            Мы их не трогаем. Пока интеграция выключена, LevelChannel
            ведёт расписание без учёта вашего календаря.
          </li>
          <li>
            <strong style={{ color: 'var(--text)' }}>Что мы не делаем:</strong>{' '}
            не читаем заголовки событий ваших учеников и других людей за
            пределами окна «сегодня → +30 дней», не передаём данные
            третьим сторонам, не храним ваш пароль Google — соединение
            установлено напрямую с Google по защищённому каналу.
          </li>
        </ul>
      </details>

      <OrphanSection initialSlots={orphanSlots} />

      <SlotModeToggle initialMode={slotMode} />

      <section
        style={{
          marginTop: 24,
          padding: 24,
          background: 'var(--surface-2, rgba(255,255,255,0.03))',
          border: '1px solid var(--border)',
          borderRadius: 12,
        }}
      >
        <h2
          style={{
            fontSize: 18,
            fontWeight: 600,
            margin: '0 0 12px 0',
          }}
        >
          Часто задаваемые вопросы
        </h2>
        <details style={{ marginBottom: 12 }}>
          <summary
            style={{
              cursor: 'pointer',
              fontSize: 14,
              fontWeight: 500,
              padding: '6px 0',
            }}
          >
            Сколько календарей я могу подключить?
          </summary>
          <p style={{ color: 'var(--secondary)', fontSize: 14, lineHeight: 1.6 }}>
            Один Google-аккаунт. Внутри него по умолчанию читаем основной
            календарь и в него же записываем уроки. Возможность выбрать
            другие календари появится позже.
          </p>
        </details>
        <details style={{ marginBottom: 12 }}>
          <summary
            style={{
              cursor: 'pointer',
              fontSize: 14,
              fontWeight: 500,
              padding: '6px 0',
            }}
          >
            Что произойдёт, если я двину урок в Google?
          </summary>
          <p style={{ color: 'var(--secondary)', fontSize: 14, lineHeight: 1.6 }}>
            В LevelChannel занятие остаётся забронированным на исходное время.
            Мы покажем баннер: «вы изменили это событие в Google» — вы
            выбираете, переносить ли занятие и в LevelChannel.
          </p>
        </details>
        <details style={{ marginBottom: 12 }}>
          <summary
            style={{
              cursor: 'pointer',
              fontSize: 14,
              fontWeight: 500,
              padding: '6px 0',
            }}
          >
            Можно ли отключить временно?
          </summary>
          <p style={{ color: 'var(--secondary)', fontSize: 14, lineHeight: 1.6 }}>
            Да, нажмите «Отключить». Подключитесь снова в любой момент —
            новые уроки начнут синхронизироваться, старые события в Google
            (созданные нами раньше) останутся.
          </p>
        </details>
        <details>
          <summary
            style={{
              cursor: 'pointer',
              fontSize: 14,
              fontWeight: 500,
              padding: '6px 0',
            }}
          >
            Зачем нужен запрос на «изменение и удаление событий»?
          </summary>
          <p style={{ color: 'var(--secondary)', fontSize: 14, lineHeight: 1.6 }}>
            Чтобы создать запись об уроке у вас в календаре и удалить её,
            когда вы отмените урок в LevelChannel. Мы не редактируем
            события, которые создали не мы.
          </p>
        </details>
      </section>
    </div>
  )
}
