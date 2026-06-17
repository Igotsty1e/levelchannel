import { cookies } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { AuthShell } from '@/components/auth-shell'
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

  return (
    <AuthShell>
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
      </div>
    </AuthShell>
  )
}
