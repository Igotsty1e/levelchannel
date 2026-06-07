import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { TeacherInviteSection } from '@/app/cabinet/teacher-invite-section'
import { SESSION_COOKIE_NAME, lookupSession } from '@/lib/auth/sessions'
import { getTeacherPlanLearnerLimit } from '@/lib/onboarding/teacher-plan-limit'
import { listLearnersForTeacher } from '@/lib/scheduling/teacher-learners'

import { LearnersListClient } from './client'

// Mobile-first cabinet restructure (2026-05-31, refined 2026-06-07).
//
// Top-level «Ученики» — один из 4 основных разделов кабинета.
// SSR-fetch + клиентский фильтр/поиск/тогглы (карточки на mobile,
// таблица на desktop).
//
// 2026-06-07: TeacherInviteSection (приглашение нового ученика)
// переехал сюда с /teacher (главной). На главной оставлен один
// primary CTA — «Открыть календарь»; приглашение логически принадлежит
// разделу «Ученики».
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
  const isVerified = Boolean(current.account.emailVerifiedAt)
  const [learners, planLearnerLimit] = await Promise.all([
    listLearnersForTeacher(teacherAccountId),
    getTeacherPlanLearnerLimit(teacherAccountId),
  ])

  // Cabinet polish 2026-06-07 (B3).
  // Удалили H1 «Ученики» — дублирует активную вкладку в `<TeacherCabinetNav>`
  // (см. docs/design-system.md §10.3). Длинный объясняющий параграф убран —
  // содержание раздела очевидно из вкладки и из самих карточек ниже.
  const activeLearnerCount = learners.filter((l) => l.isAssigned).length

  return (
    <div style={{ maxWidth: 960, margin: '0 auto' }}>
      {/* Приглашение нового ученика — перенесено сюда с /teacher
          2026-06-07: главная держит один primary CTA («Открыть
          календарь»), а приглашение логически принадлежит «Ученикам». */}
      <TeacherInviteSection
        isVerified={isVerified}
        planLearnerLimit={planLearnerLimit}
      />

      <p
        style={{
          color: 'var(--secondary)',
          marginBottom: 20,
          fontSize: 14,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {activeLearnerCount > 0
          ? `${activeLearnerCount} активных учеников.`
          : 'Активных учеников пока нет.'}
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
          paymentMethod: l.paymentMethod,
        }))}
      />
    </div>
  )
}
