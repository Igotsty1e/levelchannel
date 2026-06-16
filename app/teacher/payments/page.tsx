// teacher-payments-sbp-self-service Sub-PR D (2026-06-07).
//
// Feed заявок + история по оплатам учителя.
// Plan: docs/plans/teacher-payments-sbp-self-service.md §4.1

import { cookies } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { SESSION_COOKIE_NAME, lookupSession } from '@/lib/auth/sessions'
import { getOnboardingState } from '@/lib/onboarding/state'
import {
  listClaimsForTeacher,
  countPendingClaimsForTeacher,
  listLearnersWithUnpaidSlots,
  listExpiringPackagesForTeacher,
  getTeacherPaymentPolicy,
} from '@/lib/payments/sbp-claims'
import { listActivePaymentMethods } from '@/lib/payments/sbp-methods'
import { listRefundsForTeacher } from '@/lib/payments/sbp-refunds'

import { ClaimsFeed } from './feed'
import { PaymentsExplainer } from './explainer'
import { PolicyEditor } from './policy-editor'
import { UnpaidLearners } from './unpaid-learners'

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
  const explainerDismissed =
    'teacher_payments_explainer' in onboardingState.dismissedHints

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
        href="/teacher"
        style={{
          color: 'var(--secondary)',
          textDecoration: 'none',
          fontSize: 14,
          display: 'inline-block',
          marginBottom: 16,
        }}
      >
        ← В кабинет
      </Link>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
          marginBottom: 24,
        }}
      >
        <h1
          style={{
            fontSize: 28,
            fontWeight: 700,
            margin: 0,
            letterSpacing: '-0.01em',
          }}
        >
          Оплаты
        </h1>
        {/* 2026-06-12: secondary link на editor реквизитов — без неё
            учитель с feed-страницы не мог дойти до формы CRUD методов. */}
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

      {/* 2026-06-12 design-audit: summary-grid содержит только числа,
          которые НЕ дублируются ниже. «Должны оплатить» убран — детальная
          секция <UnpaidLearners> ниже сама показывает кол-во + сумму +
          actionable список. Дубль создавал визуальный шум на mobile. */}
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
        <div className="card" style={{ padding: 24, marginBottom: 24 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>
            Заканчиваются абонементы
          </h2>
          <p
            style={{
              color: 'var(--secondary)',
              fontSize: 13,
              marginBottom: 16,
            }}
          >
            У этих учеников осталось ≤ 2 занятий или абонемент истекает в
            ближайшие 14 дней — самое время напомнить про продление.
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
                  <div style={{ fontWeight: 600, fontSize: 15 }}>
                    {p.learnerName}
                  </div>
                  <div
                    style={{
                      color: 'var(--secondary)',
                      fontSize: 12,
                      marginTop: 2,
                    }}
                  >
                    {p.title} · осталось {p.countRemaining} из {p.countInitial}{' '}
                    · до{' '}
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
                  {p.reason === 'low_remaining'
                    ? 'мало занятий'
                    : 'скоро истекает'}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* 2026-06-16 polish: ClaimsFeed возвращает фрагмент без внешнего
          marginBottom, поэтому empty-state карточка налезала на
          PolicyEditor (и на мобиле, и на десктопе). Делаем явный
          spacing-обёртку. */}
      <div style={{ marginBottom: 24 }}>
        <ClaimsFeed initialClaims={claims} initialRefunds={refunds} />
      </div>

      <PolicyEditor initial={policy} />

      <div style={{ marginTop: 24 }}>
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
