import { cookies } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { TelegramDigestCard } from '@/components/teacher/digest-settings'
import { resolveOperatorSettingsForProbe } from '@/lib/admin/operator-settings'
import { getAuthPool } from '@/lib/auth/pool'
import { SESSION_COOKIE_NAME, lookupSession } from '@/lib/auth/sessions'
import { getGoogleIntegrationMeta } from '@/lib/calendar/integrations'
import { isCalendarConnected } from '@/lib/calendar/derive-status'

// 2026-06-17 — единая страница «Интеграции» для учителя.
// Объединяет Telegram-binding (раньше жил только в /digest) и точку
// входа в детальную настройку Google Calendar (/calendar).
//
// Тигель: per docs/plans/teacher-master-flow + owner-feedback —
// «давай перенесем подключение ТГ в раздел настроек "Интеграции"».

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const metadata = {
  title: 'Интеграции — настройки учителя — LevelChannel',
  robots: { index: false, follow: false },
}

export default async function TeacherIntegrationsPage() {
  const cookieStore = await cookies()
  const cookieValue = cookieStore.get(SESSION_COOKIE_NAME)?.value ?? null
  if (!cookieValue) redirect('/login')
  const session = await lookupSession(cookieValue)
  if (!session) redirect('/login')

  const accountId = session.account.id

  const pool = getAuthPool()
  const bindRow = await pool.query<{
    teacher_telegram_enabled: boolean
    teacher_telegram_chat_id: string | null
  }>(
    `select teacher_telegram_enabled, teacher_telegram_chat_id
       from accounts where id = $1::uuid`,
    [accountId],
  )
  const teacherTgBound = bindRow.rows[0]?.teacher_telegram_enabled === true

  const settings = await resolveOperatorSettingsForProbe('teacher-daily-digest')
  const teacherTgMasterSwitch =
    settings.TEACHER_DIGEST_TELEGRAM_ENABLED?.value === 1

  const integration = await getGoogleIntegrationMeta(accountId)
  const calendarConnected = isCalendarConnected(integration)

  return (
    <div className="digest-page">
      <div className="digest-page-back">
        <Link href="/teacher/settings" className="digest-back-link">
          ← Назад в&nbsp;настройки
        </Link>
      </div>
      <header className="digest-page-header">
        <h1 className="digest-page-title">Интеграции</h1>
        <p className="digest-page-sub">
          Подключения сторонних сервисов: Telegram-бот для уведомлений и
          Google Calendar для синхронизации расписания.
        </p>
      </header>

      <div className="digest-channel-stack">
        {/* Telegram-бот: бинд кода через бот @LevelChannelBot. */}
        <TelegramDigestCard
          initialBound={teacherTgBound}
          masterSwitchOn={teacherTgMasterSwitch}
        />

        {/* Google Calendar: краткий статус + ссылка на детальную страницу. */}
        <section
          className="card"
          style={{ padding: 20, marginBottom: 16 }}
          aria-label="Google Calendar"
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8, flexWrap: 'wrap' }}>
            <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>
              Google Calendar
            </h2>
            <span
              style={{
                fontSize: 12,
                padding: '2px 8px',
                borderRadius: 999,
                background: calendarConnected
                  ? 'rgba(155, 223, 155, 0.15)'
                  : 'rgba(161, 161, 170, 0.15)',
                color: calendarConnected ? '#9bdf9b' : 'var(--secondary)',
                fontWeight: 600,
              }}
            >
              {calendarConnected ? 'Подключён' : 'Не подключён'}
            </span>
          </div>
          <p style={{ color: 'var(--secondary)', fontSize: 14, marginBottom: 12, lineHeight: 1.5 }}>
            {calendarConnected
              ? 'Учитываем вашу занятость в расписании и записываем туда забронированные занятия.'
              : 'Подключите Google Calendar — мы будем учитывать вашу занятость и записывать туда занятия учеников.'}
          </p>
          <Link
            href="/teacher/settings/calendar"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 14px',
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'transparent',
              color: 'var(--text)',
              textDecoration: 'none',
              fontSize: 14,
              fontWeight: 500,
            }}
          >
            Настроить Google Calendar →
          </Link>
        </section>
      </div>
    </div>
  )
}
