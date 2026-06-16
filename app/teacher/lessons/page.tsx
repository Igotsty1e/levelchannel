// /teacher/lessons — Wave-2 lesson-history Sub-PR 3 (2026-06-16).
//
// Полная страница истории прошедших занятий учителя. SSR-шелл с
// initial-фетчем (за последние 30 дней) + client-island для фильтров /
// quick-actions / refresh.

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { LessonHistoryClient } from '@/components/teacher/lessons/lesson-history-client'
import { SESSION_COOKIE_NAME, lookupSession } from '@/lib/auth/sessions'
import { getDbPool } from '@/lib/db/pool'
import { listLessonHistory } from '@/lib/scheduling/slots'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const metadata = {
  title: 'Все занятия — LevelChannel',
  robots: { index: false, follow: false },
}

async function loadLearnerLabels(
  teacherAccountId: string,
): Promise<{
  labels: Record<string, string>
  options: Array<{ id: string; label: string }>
}> {
  const r = await getDbPool().query<{
    id: string
    email: string
    first_name: string | null
    last_name: string | null
    display_name: string | null
  }>(
    `select distinct la.id,
            la.email,
            ap.first_name,
            ap.last_name,
            ap.display_name
       from lesson_slots s
       join accounts la on la.id = s.learner_account_id
       left join account_profiles ap on ap.account_id = la.id
      where s.teacher_account_id = $1
      order by la.id`,
    [teacherAccountId],
  )
  const labels: Record<string, string> = {}
  const options: Array<{ id: string; label: string }> = []
  for (const row of r.rows) {
    const composed =
      row.first_name || row.last_name
        ? [row.first_name, row.last_name].filter(Boolean).join(' ').trim()
        : ''
    const label = composed || row.display_name || row.email || 'Ученик'
    labels[row.id] = label
    options.push({ id: row.id, label })
  }
  options.sort((a, b) => a.label.localeCompare(b.label, 'ru'))
  return { labels, options }
}

export default async function TeacherLessonsPage() {
  const cookieStore = await cookies()
  const cookieValue = cookieStore.get(SESSION_COOKIE_NAME)?.value ?? null
  if (!cookieValue) redirect('/login')
  const session = await lookupSession(cookieValue)
  if (!session) redirect('/login')

  const teacherAccountId = session.account.id
  const fromIso = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const [initialRows, learners] = await Promise.all([
    listLessonHistory(teacherAccountId, { fromIso, limit: 100 }),
    loadLearnerLabels(teacherAccountId),
  ])

  // Сериализуем для client island. Снимаем noisy поля slot которые
  // клиенту не нужны (events array etc).
  const rowsForClient = initialRows.map((r) => ({
    id: r.id,
    startAt: r.startAt,
    durationMinutes: r.durationMinutes,
    status: r.status,
    learnerAccountId: r.learnerAccountId,
    tariffSlug: r.tariffSlug ?? null,
    tariffAmountKopecks: r.tariffAmountKopecks ?? null,
    isMarked: r.isMarked,
  }))

  return (
    <LessonHistoryClient
      initialRows={rowsForClient}
      learnerLabels={learners.labels}
      learnerOptions={learners.options}
    />
  )
}
