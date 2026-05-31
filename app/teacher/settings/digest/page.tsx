import { cookies } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { TeacherTelegramBinding } from '@/components/teacher/teacher-telegram-binding'
import { resolveOperatorSettingsForProbe } from '@/lib/admin/operator-settings'
import { getAuthPool } from '@/lib/auth/pool'
import { SESSION_COOKIE_NAME, lookupSession } from '@/lib/auth/sessions'

// BCS-DEF-5-TG (2026-05-21) — teacher digest settings surface.
//
// Plan: docs/plans/bcs-def-5-tg-teacher-telegram-reminders.md §2.6.
//
// Auth: handled by app/teacher/layout.tsx (teacher-verified gate); this
// page can assume the cookie session resolves to a teacher (the layout
// redirects learners + admins away). The defensive `redirect('/login')`
// below covers the race where the cookie expires between the layout
// check and this page's render.

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const metadata = {
  title: 'Утренний дайджест — настройки учителя — LevelChannel',
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
  const teacherTgChatId = bindRow.rows[0]?.teacher_telegram_chat_id ?? null
  const accountEmail = bindRow.rows[0]?.email ?? null

  const settings = await resolveOperatorSettingsForProbe('teacher-daily-digest')
  const teacherTgMasterSwitch =
    settings.TEACHER_DIGEST_TELEGRAM_ENABLED?.value === 1

  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          marginBottom: 16,
        }}
      >
        <Link
          href="/teacher/settings"
          style={{
            color: 'var(--secondary)',
            textDecoration: 'none',
            fontSize: 14,
          }}
        >
          ← Назад в настройки
        </Link>
      </div>

      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>
        Уведомления и сводка занятий
      </h1>
      <p
        style={{
          color: 'var(--secondary)',
          fontSize: 14,
          lineHeight: 1.6,
          margin: '0 0 24px 0',
        }}
      >
        Каждое утро в&nbsp;08:00 по&nbsp;вашему часовому поясу мы&nbsp;присылаем
        список занятий на&nbsp;день: время начала, имя учащегося и&nbsp;ссылку
        для подключения (если она задана).
      </p>

      <section
        style={{
          padding: '16px 20px',
          border: '1px solid var(--border)',
          borderRadius: 8,
          background: 'var(--surface)',
        }}
      >
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>
          Email
        </h2>
        <p
          style={{
            color: 'var(--secondary)',
            fontSize: 14,
            lineHeight: 1.6,
            margin: 0,
          }}
        >
          Дайджест приходит на&nbsp;
          {accountEmail ? (
            <strong style={{ color: 'var(--text)' }}>{accountEmail}</strong>
          ) : (
            <span style={{ color: 'var(--secondary)' }}>e-mail аккаунта</span>
          )}
          . Email-канал нельзя отключить.
        </p>
      </section>

      <TeacherTelegramBinding
        initialBound={teacherTgBound}
        initialChatId={teacherTgChatId}
        masterSwitchOn={teacherTgMasterSwitch}
      />
    </div>
  )
}
