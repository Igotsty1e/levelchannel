import { cookies } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { AuthShell } from '@/components/auth-shell'
import { listAccountRoles } from '@/lib/auth/accounts'
import { SESSION_COOKIE_NAME, lookupSession } from '@/lib/auth/sessions'
import { getDbPool } from '@/lib/db/pool'

// BCS-C.5 — learner read-only "your teacher uses Google Calendar"
// landing. Today the page only tells the learner whether their
// assigned teacher has an active integration. Future BCS-DEF-4
// (lesson reminders) will add per-user notification toggles here.

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const metadata = {
  title: 'Календарь — настройки — LevelChannel',
}

export default async function LearnerCalendarSettingsPage() {
  const cookieStore = await cookies()
  const cookieValue = cookieStore.get(SESSION_COOKIE_NAME)?.value ?? null
  if (!cookieValue) redirect('/login')
  const session = await lookupSession(cookieValue)
  if (!session) redirect('/login')

  // Codex C.ui review: mirror the cabinet/page.tsx auth matrix. Admin →
  // /admin (no learner workflow there). Teacher-only → /teacher. Learner
  // (incl. legacy "no role" archetype) sees this page. Hybrid
  // teacher+learner keeps learner access.
  const roles = await listAccountRoles(session.account.id)
  if (roles.includes('admin')) redirect('/admin')
  if (roles.includes('teacher') && !roles.includes('student')) {
    redirect('/teacher')
  }

  const teacherId = session.account.assignedTeacherId
  let teacherSyncState: string | null = null
  if (teacherId) {
    const pool = getDbPool()
    const r = await pool.query(
      'select sync_state from teacher_calendar_integrations where account_id = $1',
      [teacherId],
    )
    teacherSyncState = r.rows[0]?.sync_state ?? null
  }

  const isTeacherConnected =
    teacherSyncState === 'active' || teacherSyncState === 'degraded'

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
        ) : isTeacherConnected ? (
          <>
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
              ✓ Ваш учитель подключил Google Calendar к LevelChannel.
            </p>
            <h2
              style={{
                fontSize: 16,
                fontWeight: 600,
                margin: '24px 0 8px 0',
              }}
            >
              Что это значит (по мере включения)
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
              <li>
                Когда учитель занят в Google Calendar другим делом, эти
                занятия будут автоматически исчезать из расписания — вы
                не сможете записаться на занятое время. Эта часть
                включится в ближайших обновлениях.
              </li>
              <li>
                Когда вы записываетесь на занятие, учитель будет сразу
                видеть его в своём календаре — вероятность «забыли про
                занятие» снизится почти до нуля. Эта часть тоже шипится
                отдельно.
              </li>
              <li>
                Сейчас подключение учителя только зафиксировано — фоновая
                синхронизация включается в следующих обновлениях.
              </li>
              <li>
                Никаких ваших календарей мы не подключаем. Это интеграция
                со стороны учителя.
              </li>
            </ul>
          </>
        ) : (
          <p
            style={{
              color: 'var(--secondary)',
              fontSize: 14,
              lineHeight: 1.6,
            }}
          >
            Сейчас ваш учитель ведёт расписание вручную через
            LevelChannel. Возможно, он подключит синхронизацию с Google
            Calendar позже — тогда вы увидите это здесь. На бронирование
            занятий это никак не влияет.
          </p>
        )}

        <p
          style={{
            color: 'var(--secondary)',
            fontSize: 12,
            margin: '32px 0 0 0',
            lineHeight: 1.5,
          }}
        >
          Напоминания о начале занятия и подключение собственного календаря
          ученика — пока в работе. Добавим следующими версиями.
        </p>
      </div>
    </AuthShell>
  )
}
