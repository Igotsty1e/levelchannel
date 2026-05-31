// Mobile-first cabinet restructure (2026-05-31) — новая главная
// учительского кабинета. Сценарий: учитель открывает кабинет с
// мобильного, видит ближайшие занятия, может пригласить ученика,
// открыть полный календарь / список учеников.
//
// 3 блока на главной (плюс банер ближайшего занятия):
//   1. Ближайшие занятия    — превью + кнопка «Открыть календарь»
//   2. Пригласить ученика   — TeacherInviteSection (переиспользуем
//                              блок из /cabinet)
//   3. Мои ученики           — компактный список + кнопка «Все ученики»
//
// Бывший контент /teacher (full-week calendar) переехал в
// /teacher/calendar. Настройки календаря / интеграции / дайджест
// доступны через /teacher/settings.
import { cookies } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { TeacherInviteSection } from '@/app/cabinet/teacher-invite-section'
import { TeacherLearnersSection } from '@/app/cabinet/teacher-learners-section'
import { SESSION_COOKIE_NAME, lookupSession } from '@/lib/auth/sessions'
import { getDbPool } from '@/lib/db/pool'
import { listLearnersForTeacher } from '@/lib/scheduling/teacher-learners'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const metadata = {
  title: 'Кабинет — LevelChannel',
  robots: { index: false, follow: false },
}

type UpcomingSlot = {
  id: string
  startAt: string
  durationMinutes: number
  learnerLabel: string
  status: string
}

async function listUpcomingSlotsForTeacher(
  teacherAccountId: string,
  limit = 3,
): Promise<UpcomingSlot[]> {
  const r = await getDbPool().query<{
    id: string
    start_at: string
    duration_minutes: number
    learner_email: string | null
    display_name: string | null
    first_name: string | null
    last_name: string | null
    status: string
  }>(
    `select s.id,
            s.start_at::text as start_at,
            s.duration_minutes,
            s.status,
            la.email as learner_email,
            ap.display_name,
            ap.first_name,
            ap.last_name
       from lesson_slots s
       left join accounts la on la.id = s.learner_account_id
       left join account_profiles ap on ap.account_id = la.id
      where s.teacher_account_id = $1
        and s.status in ('booked')
        and s.start_at > now()
      order by s.start_at asc
      limit $2`,
    [teacherAccountId, limit],
  )
  return r.rows.map((row) => {
    const composed =
      row.first_name || row.last_name
        ? [row.first_name, row.last_name].filter(Boolean).join(' ').trim()
        : ''
    const learnerLabel = composed
      || row.display_name
      || row.learner_email
      || 'Ученик'
    return {
      id: row.id,
      startAt: row.start_at,
      durationMinutes: row.duration_minutes,
      learnerLabel,
      status: row.status,
    }
  })
}

function formatSlotDateTime(iso: string): string {
  try {
    const d = new Date(iso)
    return new Intl.DateTimeFormat('ru-RU', {
      timeZone: 'Europe/Moscow',
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
    }).format(d)
  } catch {
    return iso
  }
}

export default async function TeacherHomePage() {
  const cookieStore = await cookies()
  const cookieValue = cookieStore.get(SESSION_COOKIE_NAME)?.value ?? null
  if (!cookieValue) redirect('/login')
  const current = await lookupSession(cookieValue)
  if (!current) redirect('/login')

  const teacherAccountId = current.account.id
  const isVerified = Boolean(current.account.emailVerifiedAt)

  const [upcomingSlots, allLearners] = await Promise.all([
    listUpcomingSlotsForTeacher(teacherAccountId, 3),
    listLearnersForTeacher(teacherAccountId),
  ])

  // На главной показываем максимум 5 ближайших учеников; полный
  // список — на /teacher/learners.
  const previewLearners = allLearners.slice(0, 5)

  return (
    <div style={{ maxWidth: 880, margin: '0 auto' }}>
      <h1 style={{ fontSize: 26, fontWeight: 700, marginBottom: 24 }}>
        Кабинет
      </h1>

      {/* Блок 1: Ближайшие занятия */}
      <section
        className="card"
        style={{ padding: 24, marginBottom: 24 }}
        aria-labelledby="upcoming-heading"
      >
        <h2
          id="upcoming-heading"
          style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}
        >
          Ближайшие занятия
        </h2>
        {upcomingSlots.length === 0 ? (
          <p
            style={{
              color: 'var(--secondary)',
              fontSize: 14,
              lineHeight: 1.6,
              marginBottom: 16,
            }}
          >
            Ближайших занятий пока нет. Когда появится новое занятие, оно
            отобразится здесь.
          </p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 16px' }}>
            {upcomingSlots.map((s) => (
              <li
                key={s.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 12,
                  padding: '10px 0',
                  borderBottom: '1px solid var(--border)',
                  fontSize: 14,
                }}
              >
                <span style={{ fontWeight: 500 }}>{s.learnerLabel}</span>
                <span style={{ color: 'var(--secondary)', fontSize: 13 }}>
                  {formatSlotDateTime(s.startAt)} · {s.durationMinutes} мин
                </span>
              </li>
            ))}
          </ul>
        )}
        <Link
          href="/teacher/calendar"
          className="btn-primary"
          style={{ display: 'inline-flex', minHeight: 44 }}
        >
          Открыть календарь
        </Link>
      </section>

      {/* Блок 2: Пригласить ученика — переиспользуем компонент из /cabinet */}
      <TeacherInviteSection isVerified={isVerified} />

      {/* Блок 3: Мои ученики — компактный список + ссылка на полный */}
      <TeacherLearnersSection learners={previewLearners} />
      {allLearners.length > previewLearners.length ? (
        <div style={{ marginTop: -8, marginBottom: 24 }}>
          <Link
            href="/teacher/learners"
            className="btn-secondary"
            style={{ display: 'inline-flex', minHeight: 44 }}
          >
            Все ученики ({allLearners.length})
          </Link>
        </div>
      ) : null}
    </div>
  )
}
