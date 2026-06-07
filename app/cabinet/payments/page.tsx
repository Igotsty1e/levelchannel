// teacher-payments-sbp-self-service Sub-PR C (2026-06-07).
//
// История оплат ученика. Доступ из футера /cabinet.
// Plan: docs/plans/teacher-payments-sbp-self-service.md §4.2

import { cookies } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { AuthShell } from '@/components/auth-shell'
import { SESSION_COOKIE_NAME, lookupSession } from '@/lib/auth/sessions'
import { listClaimsForLearner } from '@/lib/payments/sbp-claims'

import { LearnerPaymentsList } from './list'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const metadata = {
  title: 'История оплат — LevelChannel',
  robots: { index: false, follow: false },
}

export default async function LearnerPaymentsHistoryPage() {
  const cookieStore = await cookies()
  const cookieValue = cookieStore.get(SESSION_COOKIE_NAME)?.value ?? null
  if (!cookieValue) redirect('/login')
  const session = await lookupSession(cookieValue)
  if (!session) redirect('/login')

  const claims = await listClaimsForLearner(session.account.id, 100)

  return (
    <AuthShell>
      <div style={{ width: '100%', maxWidth: 640 }}>
        <Link
          href="/cabinet"
          style={{
            color: 'var(--secondary)',
            textDecoration: 'none',
            fontSize: 14,
            display: 'inline-block',
            marginBottom: 16,
          }}
        >
          ← Назад в кабинет
        </Link>
        <h1
          style={{
            fontSize: 28,
            fontWeight: 700,
            margin: 0,
            marginBottom: 8,
            letterSpacing: '-0.01em',
          }}
        >
          История оплат
        </h1>
        <p
          style={{
            color: 'var(--secondary)',
            fontSize: 14,
            lineHeight: 1.6,
            margin: 0,
            marginBottom: 24,
          }}
        >
          Здесь видно, что вы заявили как оплаченное, что учитель подтвердил
          и что отклонил. Деньги идут напрямую учителю — платформа их
          не держит.
        </p>

        <LearnerPaymentsList initial={claims} />
      </div>
    </AuthShell>
  )
}
