import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { SESSION_COOKIE_NAME, lookupSession } from '@/lib/auth/sessions'
import { listLearnersForTeacher } from '@/lib/scheduling/teacher-learners'

import { LearnersListClient } from './client'

// Mobile-first cabinet restructure (2026-05-31).
//
// Top-level «Ученики» — один из 4 основных разделов кабинета.
// SSR-fetch + клиентский фильтр/поиск/тогглы (карточки на mobile,
// таблица на desktop).
//
// Back-link удалён: это top-level раздел, переход через нижний bar.
//
// Anti-spoof: `teacherAccountId` resolved STRICTLY from session.

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const metadata = {
  title: 'Мои ученики — LevelChannel',
  robots: { index: false, follow: false },
}

export default async function TeacherLearnersListPage() {
  const cookieStore = await cookies()
  const cookieValue = cookieStore.get(SESSION_COOKIE_NAME)?.value ?? null
  if (!cookieValue) redirect('/login')
  const current = await lookupSession(cookieValue)
  if (!current) redirect('/login')

  const teacherAccountId = current.account.id
  const learners = await listLearnersForTeacher(teacherAccountId)

  return (
    <div style={{ maxWidth: 960, margin: '0 auto' }}>
      <h1 style={{ fontSize: 26, fontWeight: 700, marginBottom: 8 }}>
        Ученики
      </h1>
      <p style={{ color: 'var(--secondary)', marginBottom: 20, fontSize: 14 }}>
        Сводка по всем ученикам, с которыми у вас есть занятия или
        активная привязка. Кликните по карточке, чтобы открыть ученика.
      </p>

      <LearnersListClient
        learners={learners.map((l) => ({
          learnerId: l.learnerId,
          learnerEmail: l.learnerEmail,
          displayName: l.displayName,
          firstName: l.firstName ?? null,
          lastName: l.lastName ?? null,
          isAssigned: l.isAssigned,
          upcomingCount: l.upcomingCount,
          completedCount: l.completedCount,
          cancelledCount: l.cancelledCount,
          noShowCount: l.noShowCount,
        }))}
      />
    </div>
  )
}
