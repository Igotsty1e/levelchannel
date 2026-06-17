// /cabinet/lessons — 2026-06-17 Wave B (learner cabinet restructure).
//
// Полная страница истории занятий ученика: фильтры (период / статус /
// «без оплаты») + список карточек. Аналог /teacher/lessons.

import { cookies } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { LessonHistoryClient } from '@/components/cabinet/lessons-history-client'
import { SESSION_COOKIE_NAME, lookupSession } from '@/lib/auth/sessions'
import { listLearnerLessonHistory } from '@/lib/scheduling/slots'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const metadata = {
  title: 'Мои занятия — LevelChannel',
  robots: { index: false, follow: false },
}

export default async function LearnerLessonsPage() {
  const cookieStore = await cookies()
  const cookieValue = cookieStore.get(SESSION_COOKIE_NAME)?.value ?? null
  if (!cookieValue) redirect('/login')
  const session = await lookupSession(cookieValue)
  if (!session) redirect('/login')

  const fromIso = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
  const initialRows = await listLearnerLessonHistory(session.account.id, {
    fromIso,
    limit: 100,
  })

  const rowsForClient = initialRows.map((r) => ({
    id: r.id,
    startAt: r.startAt,
    durationMinutes: r.durationMinutes,
    status: r.status,
    teacherEmail: r.teacherEmail ?? null,
    tariffTitleRu: r.tariffTitleRu ?? null,
    tariffAmountKopecks: r.tariffAmountKopecks ?? null,
    isPaid: r.isPaid,
  }))

  return (
    <main style={{ maxWidth: 880, margin: '0 auto', paddingBottom: 80 }}>
      <header className="lc-section">
        <h1
          style={{
            fontSize: 28,
            fontWeight: 700,
            margin: 0,
            letterSpacing: '-0.01em',
          }}
        >
          Мои занятия
        </h1>
        <p
          style={{
            color: 'var(--secondary)',
            fontSize: 14,
            marginTop: 4,
          }}
        >
          История занятий с фильтрами. По умолчанию — за последние 90 дней.
        </p>
      </header>

      <LessonHistoryClient initialRows={rowsForClient} />

      <p style={{ fontSize: 12, color: 'var(--secondary)', marginTop: 16 }}>
        <Link href="/cabinet" style={{ color: 'inherit' }}>
          ← на главную
        </Link>
      </p>
    </main>
  )
}
