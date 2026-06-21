// /teacher/lessons — единая точка входа в журналы учителя.
// post-deploy bug bash 2026-06-19: 3-card routing (Уроки/Дела/Оплаты),
// server-side branching по searchParams.kind, /teacher/payments consolidated.

import Link from 'next/link'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { DealsSection } from '@/components/teacher/lessons/deals-section'
import { KindRoutingCards } from '@/components/teacher/lessons/kind-routing-cards'
import { LessonHistoryClient } from '@/components/teacher/lessons/lesson-history-client'
import { PaymentsSection } from '@/components/teacher/lessons/payments-section'
import { SESSION_COOKIE_NAME, lookupSession } from '@/lib/auth/sessions'
import { getDbPool } from '@/lib/db/pool'
import { listLessonHistory } from '@/lib/scheduling/slots'
import { parseKind } from '@/lib/teacher/lessons-kind'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const metadata = {
  title: 'Занятия — LevelChannel',
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

type SearchParams = {
  kind?: string | string[]
}

export default async function TeacherLessonsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const cookieStore = await cookies()
  const cookieValue = cookieStore.get(SESSION_COOKIE_NAME)?.value ?? null
  if (!cookieValue) redirect('/login')
  const session = await lookupSession(cookieValue)
  if (!session) redirect('/login')

  const teacherAccountId = session.account.id
  const sp = await searchParams
  const rawKind = Array.isArray(sp.kind) ? sp.kind[0] : sp.kind
  const kind = parseKind(rawKind ?? null)

  // Server-branching по kind: грузим только нужные данные.
  let panel: React.ReactNode = null
  if (kind === 'payments') {
    panel = <PaymentsSection teacherAccountId={teacherAccountId} />
  } else if (kind === 'deals') {
    panel = <DealsSection />
  } else {
    const fromIso = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    const [initialRows, learners] = await Promise.all([
      listLessonHistory(teacherAccountId, { fromIso, limit: 100 }),
      loadLearnerLabels(teacherAccountId),
    ])
    const rowsForClient = initialRows.map((r) => ({
      id: r.id,
      startAt: r.startAt,
      durationMinutes: r.durationMinutes,
      status: r.status,
      learnerAccountId: r.learnerAccountId,
      tariffSlug: r.tariffSlug ?? null,
      tariffAmountKopecks: r.tariffAmountKopecks ?? null,
      isMarked: r.isMarked,
      paymentStatus: r.paymentStatus,
    }))
    panel = (
      <LessonHistoryClient
        initialRows={rowsForClient}
        learnerLabels={learners.labels}
        learnerOptions={learners.options}
      />
    )
  }

  return (
    <main style={{ maxWidth: 980, margin: '0 auto', paddingBottom: 80 }}>
      <header className="lc-section" style={{ marginBottom: 16 }}>
        <h1
          style={{
            fontSize: 24,
            fontWeight: 700,
            margin: 0,
            letterSpacing: '-0.01em',
          }}
        >
          Занятия
        </h1>
        <p style={{ color: 'var(--secondary)', fontSize: 14, marginTop: 4 }}>
          История, личные дела и оплаты — в одном месте.
        </p>
      </header>

      <KindRoutingCards activeKind={kind} />

      {panel}

      <p style={{ fontSize: 12, color: 'var(--secondary)', marginTop: 16 }}>
        <Link href="/teacher" style={{ color: 'inherit' }}>
          ← на главную
        </Link>
      </p>
    </main>
  )
}
