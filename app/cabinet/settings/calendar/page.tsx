import { cookies } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { AuthShell } from '@/components/auth-shell'
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
              ✓ Ваш учитель ведёт расписание через Google Calendar.
            </p>
            <h2
              style={{
                fontSize: 16,
                fontWeight: 600,
                margin: '24px 0 8px 0',
              }}
            >
              Что это даёт вам
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
                Когда учитель занят чем-то другим в своём календаре, эти
                слоты автоматически исчезают из расписания — вы не
                сможете записаться на занятое время.
              </li>
              <li>
                Когда вы записываетесь на урок, учитель сразу видит его в
                своём календаре — вероятность «забыли про урок» снижается
                почти до нуля.
              </li>
              <li>
                Никаких ваших календарей мы не подключаем. Эта интеграция
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
            уроков это никак не влияет.
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
          Напоминания о начале урока и подключение собственного календаря
          ученика — пока в работе. Добавим следующими версиями.
        </p>
      </div>
    </AuthShell>
  )
}
