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

// Plan: docs/plans/cabinet-stale-future-labels.md §A.
// Learner-side state-aware view of teacher's Google Calendar
// integration. Renders different copy per (pullStatus × pushStatus)
// to avoid lying about what actually works.

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const metadata = {
  title: 'Календарь — настройки — LevelChannel',
}

function pullCopy(status: PullStatus): string {
  switch (status) {
    case 'no_integration':
      return 'Учитель пока не подключал Google Calendar. Время в расписании показывается как есть, без проверки занятости в чужом календаре.'
    case 'disconnected':
      return 'Учитель отключил Google Calendar. Время в расписании показывается как есть.'
    case 'active_fresh':
      return 'Когда учитель занят в Google Calendar другим делом, эти занятия автоматически исчезают из расписания — вы не сможете записаться на занятое время. ✓ Работает сейчас.'
    case 'active_stale':
      return 'Учитель подключил Google Calendar, но синхронизация сейчас отстаёт. Пока синхронизация не восстановится, занятое в Google время может не скрываться автоматически.'
    case 'degraded':
      return 'Учитель подключил Google Calendar, но Google сейчас отвечает с ошибками. Пока ошибки не пройдут, занятое в Google время может не скрываться автоматически.'
  }
}

function pushCopy(status: PushStatus): string {
  switch (status) {
    case 'works':
      return 'Когда вы записываетесь, бронь сразу появляется у учителя в Google Calendar.'
    case 'no_write_calendar':
      return 'Бронь у учителя в Google Calendar не появится: учитель пока не выбрал, в какой календарь писать.'
    case 'disconnected':
      return 'Бронь у учителя в Google Calendar не появится: учитель отключил интеграцию.'
    case 'no_integration':
      return 'Бронь у учителя в Google Calendar не появится: учитель пока не подключал Google Calendar.'
  }
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
          <>
            <h2
              style={{
                fontSize: 16,
                fontWeight: 600,
                margin: '8px 0',
              }}
              data-testid="calendar-section-heading"
            >
              Как сейчас работает синхронизация
            </h2>
            <ul
              style={{
                color: 'var(--secondary)',
                fontSize: 14,
                lineHeight: 1.7,
                paddingLeft: 20,
                margin: 0,
              }}
            >
              <li data-testid="calendar-pull-copy">{pullCopy(pullStatus)}</li>
              <li data-testid="calendar-push-copy">{pushCopy(pushStatus)}</li>
            </ul>
          </>
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

        <LearnerIcsSubscriptionBlock accountId={session.account.id} />
      </div>
    </AuthShell>
  )
}

function LearnerIcsSubscriptionBlock({ accountId }: { accountId: string }) {
  // 2026-06-17 — .ics subscription. Token зашит в URL — изолированный
  // секрет, без cookie. Если ученик скомпрометирует URL — учитель
  // ротирует LEARNER_ICS_TOKEN_SECRET.
  let icsUrl: string | null = null
  try {
    // dynamic import чтобы при отсутствии secret страница не падала
    // (мы показываем понятный fallback вместо 500).
    // Это import без сетевых запросов — стоимость минимальная.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { signLearnerIcsToken } = require('@/lib/calendar/learner-ics') as typeof import('@/lib/calendar/learner-ics')
    const token = signLearnerIcsToken(accountId)
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
