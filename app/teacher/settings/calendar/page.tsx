import { cookies } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'

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

import { CalendarConnectCard } from './connect-card'
import { OrphanSection } from './orphan-section'

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

export default async function TeacherCalendarSettingsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const params = await searchParams
  const connected = paramString(params.connected)
  const error = paramString(params.error)
  const errorReason = paramString(params.reason)
  const errorDetail = paramString(params.detail)
  const errorKind = paramString(params.kind)

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

  // BCS-G.4 — orphan-self slots (stale binding from a prior epoch).
  // Surfaced when present so the teacher can clear the local link.
  const orphanSlots = await listOrphanSelfSlotsForTeacher(session.account.id)

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
          ⚠ Не удалось завершить подключение:{' '}
          <code style={{ fontSize: 12 }}>
            {error}
            {errorReason ? `:${errorReason}` : ''}
            {errorKind ? `:${errorKind}` : ''}
            {errorDetail ? ` (${errorDetail})` : ''}
          </code>
          . Попробуйте подключиться ещё раз. Если повторяется, напишите оператору.
        </p>
      ) : null}

      <CalendarConnectCard
        configReady={configReady}
        configError={configError}
        isConnected={isConnected}
        syncState={integration?.syncState ?? null}
        lastReconnectedAt={integration?.lastReconnectedAt ?? null}
      />

      <section
        style={{
          marginTop: 40,
          padding: 24,
          background: 'var(--surface-2, rgba(255,255,255,0.03))',
          border: '1px solid var(--border)',
          borderRadius: 12,
        }}
      >
        <h2
          data-testid="teacher-calendar-list-heading"
          style={{
            fontSize: 18,
            fontWeight: 600,
            margin: '0 0 12px 0',
          }}
        >
          Как работает интеграция с Google Calendar
        </h2>
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
      </section>

      <OrphanSection initialSlots={orphanSlots} />

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
