import { cookies } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { resolveOperatorSettingsForProbe } from '@/lib/admin/operator-settings'
import { listAccountRoles } from '@/lib/auth/accounts'
import { SESSION_COOKIE_NAME, lookupSession } from '@/lib/auth/sessions'
import { getActiveTeacherForLearner } from '@/lib/auth/teacher-scope'
import {
  derivePullStatus,
  derivePushStatus,
  type PullStatus,
  type PushStatus,
} from '@/lib/calendar/derive-status'
import { getGoogleIntegrationMeta } from '@/lib/calendar/integrations'

// 2026-06-17 cabinet-settings-calendar-copy: owner-feedback — две
// отдельные строки про pull/push «странно читались», особенно когда у
// учителя нет интеграции вовсе. Сворачиваем в одну консолидированную
// строку статуса + цветной маркер. Никакой технической детали про
// «занятость в чужом календаре» — учнику этого знать не нужно.
//
// Прежний contract — docs/plans/cabinet-stale-future-labels.md §A.

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const metadata = {
  title: 'Календарь — настройки — LevelChannel',
}

type CalendarStatusIntent = 'idle' | 'ok' | 'warn'

function combinedCalendarCopy(
  pull: PullStatus,
  push: PushStatus,
): { intent: CalendarStatusIntent; text: string } {
  // Полностью здоровая интеграция — pull свежий, push настроен.
  if (pull === 'active_fresh' && push === 'works') {
    return {
      intent: 'ok',
      text: 'Google Calendar учителя подключён. Занятое в нём время автоматически скрывается из расписания, а ваши брони сразу попадают учителю в календарь.',
    }
  }

  // Учитель ничего не подключал.
  if (pull === 'no_integration' && push === 'no_integration') {
    return {
      intent: 'idle',
      text: 'Расписание ведётся внутри LevelChannel. Внешний календарь учителю подключать не обязательно — бронирование занятий работает напрямую через сайт.',
    }
  }

  // Учитель отключил.
  if (pull === 'disconnected' && push === 'disconnected') {
    return {
      intent: 'idle',
      text: 'Google Calendar учителя сейчас отключён. На бронирование занятий это не влияет — расписание ведётся в LevelChannel.',
    }
  }

  // Подключён, но синхронизация отстаёт / Google отвечает с ошибками.
  if (pull === 'active_stale' || pull === 'degraded') {
    return {
      intent: 'warn',
      text: 'Google Calendar учителя подключён, но синхронизация сейчас отстаёт. Это временно — бронирование занятий продолжает работать.',
    }
  }

  // Подключён на чтение, но писать ваши брони туда некуда.
  if (pull === 'active_fresh' && push === 'no_write_calendar') {
    return {
      intent: 'warn',
      text: 'Google Calendar учителя подключён только на чтение. Занятое в нём время скрывается, но брони пока не попадают в его календарь автоматически.',
    }
  }

  // Нестандартные комбинации — короткий честный fallback.
  return {
    intent: 'warn',
    text: 'Google Calendar учителя в смешанном состоянии. Бронирование занятий продолжает работать через LevelChannel.',
  }
}

const DOT_COLOR: Record<CalendarStatusIntent, string> = {
  ok: 'rgb(46, 160, 67)',
  warn: 'rgb(212, 153, 0)',
  idle: 'var(--secondary)',
}

export default async function LearnerCalendarSettingsPage() {
  const cookieStore = await cookies()
  const cookieValue = cookieStore.get(SESSION_COOKIE_NAME)?.value ?? null
  if (!cookieValue) redirect('/login')
  const session = await lookupSession(cookieValue)
  if (!session) redirect('/login')

  const roles = await listAccountRoles(session.account.id)
  if (roles.includes('admin')) redirect('/admin')
  if (roles.includes('teacher') && !roles.includes('student')) {
    // R-AMBIG-1 resolved 2026-06-03: teacher-only navigating to the
    // learner-side calendar settings surface is redirected to the
    // analogous teacher surface, not to the teacher dashboard root.
    // Same role scope, just lands them on the page they actually
    // wanted (their calendar settings).
    // Contract: evals/URL_REDIRECT_CONTRACT.md Table 2.
    redirect('/teacher/settings/calendar')
  }

  const resolved = await getActiveTeacherForLearner(session.account.id)
  const teacherId = resolved.teacherId ?? session.account.assignedTeacherId

  const integration = teacherId
    ? await getGoogleIntegrationMeta(teacherId)
    : null
  const pullStatus = derivePullStatus(integration)
  const pushStatus = derivePushStatus(integration)

  const operatorSettings = await resolveOperatorSettingsForProbe(
    'learner-reminders',
  )
  const operatorMasterSwitchOn =
    operatorSettings.LEARNER_REMINDERS_EMAIL_ENABLED?.value === 1

  // 2026-06-18 codex-audit BLOCKER §5.1: читаем ics_token_version из
  // БД здесь, в parent server-component, чтобы child остался sync (иначе
  // vitest/RTL ломаются на async компоненте).
  const tokenVersion = await (async () => {
    try {
      const { getDbPool } = await import('@/lib/db/pool')
      const r = await getDbPool().query<{ ics_token_version: number }>(
        `select ics_token_version from accounts where id = $1`,
        [session.account.id],
      )
      return r.rows[0]?.ics_token_version ?? 1
    } catch {
      return 1
    }
  })()

  return (
    <>
      <div style={{ width: '100%', maxWidth: 520, padding: '24px 16px' }}>
        <Link
          href="/cabinet"
          style={{
            color: 'var(--secondary)',
            fontSize: 13,
            textDecoration: 'none',
          }}
        >
          ← В кабинет
        </Link>

        <h1
          style={{
            fontSize: 24,
            fontWeight: 700,
            margin: '16px 0 12px 0',
          }}
        >
          Календарь
        </h1>

        {!teacherId ? (
          <p
            style={{
              color: 'var(--secondary)',
              fontSize: 14,
              lineHeight: 1.6,
            }}
          >
            Учитель пока не назначен. После того как оператор привяжет
            вас, здесь появится информация о его расписании.
          </p>
        ) : (
          (() => {
            const status = combinedCalendarCopy(pullStatus, pushStatus)
            return (
              <div
                data-testid="calendar-status-block"
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 10,
                  padding: '12px 14px',
                  border: '1px solid var(--border)',
                  borderRadius: 10,
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: DOT_COLOR[status.intent],
                    marginTop: 7,
                    flexShrink: 0,
                  }}
                />
                <p
                  data-testid="calendar-status-copy"
                  style={{
                    margin: 0,
                    color: 'var(--text)',
                    fontSize: 14,
                    lineHeight: 1.6,
                  }}
                >
                  {status.text}
                </p>
              </div>
            )
          })()
        )}

        <p
          data-testid="calendar-reminder-footer"
          style={{
            color: 'var(--secondary)',
            fontSize: 12,
            margin: '32px 0 0 0',
            lineHeight: 1.5,
          }}
        >
          {operatorMasterSwitchOn
            ? '✓ Email-напоминания приходят перед занятиями.'
            : 'Email-напоминания временно выключены оператором.'}
        </p>

        <LearnerIcsSubscriptionBlock
          accountId={session.account.id}
          tokenVersion={tokenVersion}
        />
      </div>
    </>
  )
}

function LearnerIcsSubscriptionBlock({
  accountId,
  tokenVersion,
}: {
  accountId: string
  tokenVersion: number
}) {
  // 2026-06-17 — .ics subscription. Token зашит в URL — изолированный
  // секрет, без cookie.
  //
  // 2026-06-18 codex-audit BLOCKER §5.1 fix:
  // Token подписан HMAC over (accountId | version | expiresAt). Version
  // приходит prop'ом из parent server-component (там idempotent DB
  // read), компонент остаётся sync чтобы vitest/RTL могли рендерить.
  // TTL 90 дней; страница каждый раз генерит свежий токен — calendar
  // apps подхватывают через очередной poll.
  let icsUrl: string | null = null
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { signLearnerIcsToken } = require('@/lib/calendar/learner-ics') as typeof import('@/lib/calendar/learner-ics')
    const token = signLearnerIcsToken(accountId, tokenVersion)
    const base = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, '') || ''
    icsUrl = `${base}/api/learner/calendar.ics?account=${accountId}&token=${token}`
  } catch {
    icsUrl = null
  }

  return (
    <div
      style={{
        marginTop: 24,
        padding: 16,
        border: '1px solid var(--border)',
        borderRadius: 12,
        background: 'var(--surface)',
      }}
    >
      <h2 style={{ fontSize: 18, fontWeight: 600, margin: '0 0 8px' }}>
        Подписка на занятия в Google Calendar / Apple Calendar
      </h2>
      <p style={{ color: 'var(--secondary)', fontSize: 13, marginBottom: 12, lineHeight: 1.5 }}>
        Скопируйте ссылку и добавьте её в календарь как «по подписке» (subscribed calendar).
        Календарь будет автоматически обновляться при изменениях.
      </p>
      {icsUrl ? (
        <code
          style={{
            display: 'block',
            padding: '8px 10px',
            background: 'var(--bg)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            fontSize: 12,
            wordBreak: 'break-all',
            color: 'var(--secondary)',
          }}
        >
          {icsUrl}
        </code>
      ) : (
        <p style={{ color: 'var(--danger)', fontSize: 13 }}>
          Подписка временно недоступна — оператор не настроил секрет
          LEARNER_ICS_TOKEN_SECRET. Напишите учителю.
        </p>
      )}
    </div>
  )
}
