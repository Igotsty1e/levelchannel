// teacher-payments-sbp-self-service Sub-PR D (2026-06-07).
//
// Feed заявок + история по оплатам учителя.
// Plan: docs/plans/teacher-payments-sbp-self-service.md §4.1

import { cookies } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { SESSION_COOKIE_NAME, lookupSession } from '@/lib/auth/sessions'
import {
  listClaimsForTeacher,
  countPendingClaimsForTeacher,
} from '@/lib/payments/sbp-claims'

import { ClaimsFeed } from './feed'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const metadata = {
  title: 'Оплаты — LevelChannel',
  robots: { index: false, follow: false },
}

function formatRub(kopecks: number): string {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(kopecks / 100)
}

export default async function TeacherPaymentsPage() {
  const cookieStore = await cookies()
  const cookieValue = cookieStore.get(SESSION_COOKIE_NAME)?.value ?? null
  if (!cookieValue) redirect('/login')
  const session = await lookupSession(cookieValue)
  if (!session) redirect('/login')

  const teacherAccountId = session.account.id

  const [claims, pendingCount] = await Promise.all([
    listClaimsForTeacher(teacherAccountId, ['claimed', 'confirmed', 'declined'], 100),
    countPendingClaimsForTeacher(teacherAccountId),
  ])

  const pendingClaims = claims.filter((c) => c.status === 'claimed')
  const confirmedThisMonth = (() => {
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    return claims.filter(
      (c) =>
        c.status === 'confirmed'
        && new Date(c.resolvedAt ?? c.claimedAt) >= monthStart,
    )
  })()
  const confirmedSum = confirmedThisMonth.reduce(
    (acc, c) => acc + c.amountKopecks,
    0,
  )
  const pendingSum = pendingClaims.reduce(
    (acc, c) => acc + c.amountKopecks,
    0,
  )

  return (
    <div style={{ maxWidth: 880, margin: '0 auto' }}>
      <Link
        href="/teacher/settings"
        style={{
          color: 'var(--secondary)',
          textDecoration: 'none',
          fontSize: 14,
          display: 'inline-block',
          marginBottom: 16,
        }}
      >
        ← Назад в настройки
      </Link>
      <h1
        style={{
          fontSize: 28,
          fontWeight: 700,
          margin: 0,
          marginBottom: 24,
          letterSpacing: '-0.01em',
        }}
      >
        Оплаты
      </h1>

      <div
        style={{
          display: 'grid',
          gap: 16,
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          marginBottom: 24,
        }}
      >
        <SummaryCard
          title="Ждут подтверждения"
          value={`${pendingCount}`}
          subtitle={pendingCount > 0 ? formatRub(pendingSum) : null}
          accent={pendingCount > 0}
        />
        <SummaryCard
          title="Подтверждено за месяц"
          value={`${confirmedThisMonth.length}`}
          subtitle={confirmedThisMonth.length > 0 ? formatRub(confirmedSum) : null}
        />
      </div>

      <ClaimsFeed initialClaims={claims} />
    </div>
  )
}

function SummaryCard({
  title,
  value,
  subtitle,
  accent,
}: {
  title: string
  value: string
  subtitle: string | null
  accent?: boolean
}) {
  return (
    <div
      className="card"
      style={{
        padding: 16,
        borderColor: accent ? 'var(--accent)' : undefined,
      }}
    >
      <div
        style={{
          fontSize: 12,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          color: 'var(--secondary)',
          marginBottom: 6,
        }}
      >
        {title}
      </div>
      <div style={{ fontSize: 24, fontWeight: 700 }}>{value}</div>
      {subtitle ? (
        <div
          style={{
            fontSize: 13,
            color: 'var(--secondary)',
            marginTop: 4,
          }}
        >
          {subtitle}
        </div>
      ) : null}
    </div>
  )
}
