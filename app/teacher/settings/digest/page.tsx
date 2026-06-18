import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import Link from 'next/link'

import {
  EmailDigestCard,
  PushDigestCard,
} from '@/components/teacher/digest-settings'
import { NotificationPreferencesMatrix } from '@/components/teacher/notification-preferences-matrix'
import { resolveOperatorSettingsForProbe } from '@/lib/admin/operator-settings'
import { getAuthPool } from '@/lib/auth/pool'
import { SESSION_COOKIE_NAME, lookupSession } from '@/lib/auth/sessions'
import { listNotificationPreferences } from '@/lib/notifications/preferences'

// BCS-DEF-5-TG (2026-05-21) — teacher digest settings surface.
//
// Deep UX redesign 2026-06-07 — каналы как набор карточек (e-mail /
// Telegram / Push), статус-пиллы вместо текстовых «нельзя отключить»,
// bind-code в модалке поверх карточки. Плановый документ:
// docs/plans/bcs-def-5-tg-teacher-telegram-reminders.md §2.6 (auth +
// data shape без изменений; меняем только UI слой).
//
// Auth: handled by app/teacher/layout.tsx (teacher-verified gate); this
// page can assume the cookie session resolves to a teacher (the layout
// redirects learners + admins away). The defensive `redirect('/login')`
// below covers the race where the cookie expires between the layout
// check and this page's render.

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const metadata = {
  title: 'Уведомления — настройки учителя — LevelChannel',
  robots: { index: false, follow: false },
}

export default async function TeacherDigestSettingsPage() {
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
    email: string | null
  }>(
    `select teacher_telegram_enabled, teacher_telegram_chat_id, email
       from accounts where id = $1::uuid`,
    [accountId],
  )
  const teacherTgBound = bindRow.rows[0]?.teacher_telegram_enabled === true
  const initialPreferences = await listNotificationPreferences(accountId)
  const accountEmail = bindRow.rows[0]?.email ?? null

  return (
    <div className="digest-page">
      <div className="digest-page-back">
        <Link href="/teacher/settings" className="digest-back-link">
          ← Назад в&nbsp;настройки
        </Link>
      </div>
      <header className="digest-page-header">
        <h1 className="digest-page-title">Уведомления</h1>
        <p className="digest-page-sub">
          Каждое утро в&nbsp;08:00 по&nbsp;вашему часовому поясу
          присылаем дайджест на&nbsp;день: время начала, имя ученика
          и&nbsp;ссылку для подключения. Каналы — e-mail и push в браузере.
          {' '}Telegram-бот для дайджеста и&nbsp;уведомлений настраивается{' '}
          <Link href="/teacher/settings/integrations" style={{ color: 'inherit', textDecoration: 'underline' }}>
            в разделе «Интеграции»
          </Link>
          {teacherTgBound ? ' (сейчас подключён)' : ''}.
        </p>
      </header>

      <div className="digest-channel-stack">
        <EmailDigestCard email={accountEmail} />
        <PushDigestCard />
      </div>

      {/* Epic D (2026-06-18) — гранулярные настройки уведомлений
          per-event × per-channel. Default ON; учитель может выключить
          конкретные события в конкретных каналах. */}
      <NotificationPreferencesMatrix
        initialPreferences={initialPreferences}
      />
    </div>
  )
}
