import { cookies } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { SESSION_COOKIE_NAME, lookupSession } from '@/lib/auth/sessions'
import { listLearnersForTeacher } from '@/lib/scheduling/teacher-learners'

// Teacher-cabinet-polish — TASK-4 Sub-PR E.
//
// Plan: docs/plans/teacher-cabinet-polish.md §3 Sub-PR E + §Q-12.
//
// Top-level "Ученики" surface for the teacher cabinet. Renders the
// same row set as the cabinet's `<TeacherLearnersSection>` mini-block,
// but as a full-width SSR list with each learner name linking to the
// existing drill-down at `/teacher/learners/[id]` (Day 5A page).
//
// Anti-spoof: `teacherAccountId` is resolved STRICTLY from
// `lookupSession(cookieValue).account.id` — no body / query trust.
// The teacher layout already enforces teacher + verified, so by the
// time this page renders the session is guaranteed to be a verified
// teacher. We re-resolve it here only to hand the id to
// `listLearnersForTeacher` (the same pattern as `app/teacher/page.tsx`
// and `app/teacher/learners/[id]/page.tsx`).
//
// Sort: helper's existing order `is_assigned DESC,
// (upcoming_count + completed_count) DESC, email ASC` — DO NOT override.

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
      <div style={{ marginBottom: 16 }}>
        <Link
          href="/teacher"
          style={{ color: 'var(--secondary)', textDecoration: 'none', fontSize: 14 }}
        >
          ← Назад в календарь
        </Link>
      </div>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>
        Мои ученики
      </h1>
      <p style={{ color: 'var(--secondary)', marginBottom: 24, fontSize: 14 }}>
        Сводка по всем ученикам, с которыми у вас есть занятия или
        активная привязка. Кликните по имени, чтобы открыть карточку
        ученика.
      </p>

      {learners.length === 0 ? (
        <p style={{ color: 'var(--secondary)' }}>
          У вас пока нет учеников. Пригласите первого через ссылку в Кабинете.
        </p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              <th style={{ textAlign: 'left', padding: '8px 4px' }}>Имя</th>
              <th style={{ textAlign: 'left', padding: '8px 4px' }}>Email</th>
              <th style={{ textAlign: 'left', padding: '8px 4px' }}>Назначен</th>
              <th style={{ textAlign: 'right', padding: '8px 4px' }}>Будущих</th>
              <th style={{ textAlign: 'right', padding: '8px 4px' }}>Проведено</th>
              <th style={{ textAlign: 'right', padding: '8px 4px' }}>Отменено</th>
              <th style={{ textAlign: 'right', padding: '8px 4px' }}>Не пришёл</th>
            </tr>
          </thead>
          <tbody>
            {learners.map((l) => (
              <tr
                key={l.learnerId}
                style={{ borderBottom: '1px solid var(--border)' }}
              >
                <td style={{ padding: '8px 4px' }}>
                  <Link
                    href={`/teacher/learners/${l.learnerId}`}
                    style={{
                      color: 'var(--text)',
                      textDecoration: 'none',
                      fontWeight: 500,
                    }}
                  >
                    {l.displayName || l.learnerEmail}
                  </Link>
                </td>
                <td
                  style={{
                    padding: '8px 4px',
                    color: 'var(--secondary)',
                    fontSize: 13,
                  }}
                >
                  {l.learnerEmail}
                </td>
                <td style={{ padding: '8px 4px', fontSize: 13 }}>
                  {l.isAssigned ? (
                    <span style={{ color: '#9bdf9b' }}>● Да</span>
                  ) : (
                    <span style={{ color: 'var(--secondary)' }}>архив</span>
                  )}
                </td>
                <td style={{ textAlign: 'right', padding: '8px 4px' }}>
                  {l.upcomingCount}
                </td>
                <td style={{ textAlign: 'right', padding: '8px 4px' }}>
                  {l.completedCount}
                </td>
                <td style={{ textAlign: 'right', padding: '8px 4px' }}>
                  {l.cancelledCount}
                </td>
                <td
                  style={{
                    textAlign: 'right',
                    padding: '8px 4px',
                    color: l.noShowCount > 0 ? 'var(--text)' : 'var(--secondary)',
                  }}
                >
                  {l.noShowCount}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
