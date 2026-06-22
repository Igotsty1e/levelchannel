// Payments section для /teacher/lessons?kind=payments.
// Server component — physically перенесён из app/teacher/payments/page.tsx
// (post-deploy bug bash 2026-06-19: убираем duplication, оставляем
// /teacher/payments как thin redirect).

import Link from 'next/link'

import { ClaimsFeed } from '@/app/teacher/payments/feed'
import { PaymentsExplainer } from '@/app/teacher/payments/explainer'
import { PolicyEditor } from '@/app/teacher/payments/policy-editor'
import { UnpaidLearners } from '@/app/teacher/payments/unpaid-learners'
import { getOnboardingState } from '@/lib/onboarding/state'
import {
  countPendingClaimsForTeacher,
  getTeacherPaymentPolicy,
  listClaimsForTeacher,
  listExpiringPackagesForTeacher,
  listLearnersWithUnpaidSlots,
} from '@/lib/payments/sbp-claims'
import { listActivePaymentMethods } from '@/lib/payments/sbp-methods'
import { listRefundsForTeacher } from '@/lib/payments/sbp-refunds'

type Props = {
  teacherAccountId: string
}

function formatRub(kopecks: number): string {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(kopecks / 100)
}

export async function PaymentsSection({ teacherAccountId }: Props) {
  const [
    claims,
    pendingCount,
    unpaidLearners,
    methods,
    refunds,
    policy,
    expiring,
    onboardingState,
  ] = await Promise.all([
    listClaimsForTeacher(teacherAccountId, ['claimed', 'confirmed', 'declined'], 100),
    countPendingClaimsForTeacher(teacherAccountId),
    listLearnersWithUnpaidSlots(teacherAccountId),
    listActivePaymentMethods(teacherAccountId),
    listRefundsForTeacher(teacherAccountId, 50),
    getTeacherPaymentPolicy(teacherAccountId),
    listExpiringPackagesForTeacher(teacherAccountId),
    getOnboardingState(teacherAccountId),
  ])
  const explainerDismissed = 'teacher_payments_explainer' in onboardingState.dismissedHints

  const pendingClaims = claims.filter((c) => c.status === 'claimed')
  const confirmedThisMonth = (() => {
    const now = new Date()
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    return claims.filter(
      (c) =>
        c.status === 'confirmed'
        && new Date(c.resolvedAt ?? c.claimedAt) >= monthStart,
    )
  })()
  const confirmedSum = confirmedThisMonth.reduce((acc, c) => acc + c.amountKopecks, 0)
  const pendingSum = pendingClaims.reduce((acc, c) => acc + c.amountKopecks, 0)

  return (
    <section className="lc-stack-card" style={{ maxWidth: 880, margin: '0 auto' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <h2
          style={{
            fontSize: 22,
            fontWeight: 700,
            margin: 0,
            letterSpacing: '-0.01em',
          }}
        >
          Оплаты
        </h2>
        <Link
          href="/teacher/settings/payment-methods"
          style={{
            color: 'var(--secondary)',
            textDecoration: 'underline',
            fontSize: 13,
          }}
        >
          Настроить реквизиты СБП →
        </Link>
      </div>

      {!explainerDismissed ? <PaymentsExplainer /> : null}

      <div
        style={{
          display: 'grid',
          gap: 'var(--space-intra)',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
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

      {unpaidLearners.length > 0 ? (
        <UnpaidLearners
          learners={unpaidLearners}
          methods={methods.map((m) => ({
            id: m.id,
            phoneDisplay: m.phoneDisplay,
            bankLabel: m.bankLabel,
            isDefault: m.isDefault,
          }))}
        />
      ) : null}

      {expiring.length > 0 ? (
        <div className="card" style={{ padding: 24 }}>
          <h3 style={{ fontSize: 17, fontWeight: 600, marginBottom: 8 }}>
            Заканчиваются абонементы
          </h3>
          <p
            style={{
              color: 'var(--secondary)',
              fontSize: 13,
              marginBottom: 16,
            }}
          >
            У этих учеников осталось ≤ 2 занятий или абонемент истекает в ближайшие 14 дней.
          </p>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
            {expiring.map((p) => (
              <li
                key={p.purchaseId}
                style={{
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  padding: 12,
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 12,
                  flexWrap: 'wrap',
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, fontSize: 15 }}>{p.learnerName}</div>
                  <div
                    style={{
                      color: 'var(--secondary)',
                      fontSize: 12,
                      marginTop: 2,
                    }}
                  >
                    {p.title} · осталось {p.countRemaining} из {p.countInitial} · до{' '}
                    {new Date(p.expiresAt).toLocaleDateString('ru-RU', {
                      day: '2-digit',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </div>
                </div>
                <div
                  style={{
                    color:
                      p.reason === 'low_remaining'
                        ? 'var(--warning)'
                        : 'var(--secondary)',
                    fontSize: 12,
                  }}
                >
                  {p.reason === 'low_remaining' ? 'мало занятий' : 'скоро истекает'}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <ClaimsFeed initialClaims={claims} initialRefunds={refunds} />

      <PolicyEditor initial={policy} />

      <div>
        <a
          href={`/api/teacher/payment-claims/export.csv?from=${encodeURIComponent(
            new Date(new Date().getFullYear(), new Date().getMonth() - 3, 1)
              .toISOString()
              .slice(0, 10),
          )}`}
          style={{
            color: 'var(--secondary)',
            textDecoration: 'underline',
            fontSize: 13,
          }}
        >
          Скачать CSV за последние 3 месяца (для налоговой)
        </a>
      </div>
    </section>
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
      <div style={{ fontSize: 22, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      {subtitle ? (
        <div
          style={{
            fontSize: 13,
            color: 'var(--secondary)',
            marginTop: 4,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {subtitle}
        </div>
      ) : null}
    </div>
  )
}
