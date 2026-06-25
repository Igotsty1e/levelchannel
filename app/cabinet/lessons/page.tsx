// /cabinet/lessons — 2026-06-17 Wave B + Sub-tabs (owner-feedback).
//
// 2 таба: «История» (LessonHistoryClient — занятия с фильтрами) и
// «Оплаты» (LearnerPaymentsList — claims + refunds). Выбор таба через
// query string `?tab=history|payments` (default = history).
//
// Owner-feedback 2026-06-17: «И внутри него еще таб с оплатами —
// чтобы все тоже было в одном едином месте».

import { cookies } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { LessonHistoryClient } from '@/components/cabinet/lessons-history-client'
import { LessonsTabsClient } from '@/components/cabinet/lessons-tabs-client'
import { SESSION_COOKIE_NAME, lookupSession } from '@/lib/auth/sessions'
import { listClaimsForLearner } from '@/lib/payments/sbp-claims'
import { listRefundsForLearner } from '@/lib/payments/sbp-refunds'
import { listLearnerLessonHistory } from '@/lib/scheduling/slots'

import { LearnerPaymentsList } from '../payments/list'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const metadata = {
  title: 'Мои занятия — LevelChannel',
  robots: { index: false, follow: false },
}

type SearchParams = Promise<{ tab?: string | string[] }>

export default async function LearnerLessonsPage({
  searchParams,
}: {
  searchParams?: SearchParams
}) {
  const cookieStore = await cookies()
  const cookieValue = cookieStore.get(SESSION_COOKIE_NAME)?.value ?? null
  if (!cookieValue) redirect('/login')
  const session = await lookupSession(cookieValue)
  if (!session) redirect('/login')

  const sp = (await searchParams) ?? {}
  const tabRaw = Array.isArray(sp.tab) ? sp.tab[0] : sp.tab
  const activeTab: 'history' | 'payments' = tabRaw === 'payments' ? 'payments' : 'history'

  const fromIso = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
  const [historyRows, claims, refunds] = await Promise.all([
    listLearnerLessonHistory(session.account.id, { fromIso, limit: 100 }),
    listClaimsForLearner(session.account.id, 100),
    listRefundsForLearner(session.account.id, 100),
  ])

  const rowsForClient = historyRows.map((r) => ({
    id: r.id,
    startAt: r.startAt,
    durationMinutes: r.durationMinutes,
    status: r.status,
    teacherEmail: r.teacherEmail ?? null,
    tariffTitleRu: r.tariffTitleRu ?? null,
    tariffAmountKopecks: r.tariffAmountKopecks ?? null,
    isPaid: r.isPaid,
  }))

  const pendingCount = claims.filter((c) => c.status === 'claimed').length

  return (
    // 2026-06-25 a11y: <main> → <div>. Layout уже даёт <main>.
    <div style={{ maxWidth: 880, margin: '0 auto', paddingBottom: 80 }}>
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
          История занятий и заявки на оплату — в одном месте.
        </p>
      </header>

      <LessonsTabsClient
        active={activeTab}
        historyCount={historyRows.length}
        paymentsCount={claims.length}
        pendingCount={pendingCount}
      />

      {activeTab === 'history' ? (
        <LessonHistoryClient initialRows={rowsForClient} />
      ) : (
        <section className="lc-section">
          <LearnerPaymentsList initial={claims} initialRefunds={refunds} />
        </section>
      )}

      <p style={{ fontSize: 12, color: 'var(--secondary)', marginTop: 16 }}>
        <Link href="/cabinet" style={{ color: 'inherit' }}>
          ← на главную
        </Link>
      </p>
    </div>
  )
}
