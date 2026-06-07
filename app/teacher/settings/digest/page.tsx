import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import {
  EmailDigestCard,
  PushDigestCard,
  TelegramDigestCard,
} from '@/components/teacher/digest-settings'
import { resolveOperatorSettingsForProbe } from '@/lib/admin/operator-settings'
import { getAuthPool } from '@/lib/auth/pool'
import { SESSION_COOKIE_NAME, lookupSession } from '@/lib/auth/sessions'

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
  const accountEmail = bindRow.rows[0]?.email ?? null

  const settings = await resolveOperatorSettingsForProbe('teacher-daily-digest')
  const teacherTgMasterSwitch =
    settings.TEACHER_DIGEST_TELEGRAM_ENABLED?.value === 1

  return (
    <div className="digest-page">
      <div className="digest-page-back">
        <a href="/teacher/settings" className="digest-back-link">
          ← Назад в&nbsp;настройки
        </a>
      </div>
      <header className="digest-page-header">
        <h1 className="digest-page-title">Уведомления</h1>
        <p className="digest-page-sub">
          Каждое утро в&nbsp;08:00 по&nbsp;вашему часовому поясу
          присылаем дайджест на&nbsp;день: время начала, имя ученика
          и&nbsp;ссылку для подключения. Ниже — каналы, по&nbsp;которым
          приходит дайджест.
        </p>
      </header>

      <div className="digest-channel-stack">
        <EmailDigestCard email={accountEmail} />
        <TelegramDigestCard
          initialBound={teacherTgBound}
          masterSwitchOn={teacherTgMasterSwitch}
        />
        <PushDigestCard />
      </div>
    </div>
  )
}
