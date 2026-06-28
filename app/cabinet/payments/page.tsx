// teacher-payments-sbp-self-service Sub-PR C (2026-06-07).
//
// История оплат ученика. Доступ из футера /cabinet.
// Plan: docs/plans/teacher-payments-sbp-self-service.md §4.2

import { cookies } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { SESSION_COOKIE_NAME, lookupSession } from '@/lib/auth/sessions'
import { LearnerPaymentsExplainer } from '@/components/cabinet/payments-explainer'
import { getOnboardingState } from '@/lib/onboarding/state'
import { listClaimsForLearner } from '@/lib/payments/sbp-claims'
import { listRefundsForLearner } from '@/lib/payments/sbp-refunds'

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

  const [claims, refunds, onboardingState] = await Promise.all([
    listClaimsForLearner(session.account.id, 100),
    listRefundsForLearner(session.account.id, 100),
    getOnboardingState(session.account.id),
  ])
  const hasPending = claims.some((c) => c.status === 'claimed')
  const hasRefunds = refunds.length > 0
  const claimWaitingDismissed =
    'learner_pay_claim_waiting_explained' in onboardingState.dismissedHints
  const refundDismissed =
    'learner_pay_refund_explained' in onboardingState.dismissedHints

  return (
    <>
      <div style={{ width: '100%', maxWidth: 640, marginInline: 'auto' }}>
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
          Здесь видны все ваши заявки на оплату — те, что вы отметили
          сами, и те, что зафиксировал учитель. Деньги идут напрямую
          учителю — платформа их не держит.
        </p>

        {hasPending && !claimWaitingDismissed ? (
          <LearnerPaymentsExplainer
            hintKey="learner_pay_claim_waiting_explained"
            initiallyDismissed={false}
          >
            <strong>«Ждёт подтверждения».</strong> Учитель ещё не проверил
            ваш перевод. Обычно это занимает один-два дня — мы покажем
            «Подтверждено», когда учитель увидит деньги. Если что-то пошло
            не так — учитель сможет нажать «Не пришло», и тогда заявка
            станет «Не подтверждено».
          </LearnerPaymentsExplainer>
        ) : null}
        {hasRefunds && !refundDismissed ? (
          <LearnerPaymentsExplainer
            hintKey="learner_pay_refund_explained"
            initiallyDismissed={false}
            tone="warning"
          >
            <strong>Возврат — это запись, не операция.</strong> Деньги
            возвращает учитель напрямую вам через свой банк. Эта строка
            здесь нужна только для вашей истории — чтобы было видно, что
            возврат состоялся. Если деньги не пришли — напишите учителю.
          </LearnerPaymentsExplainer>
        ) : null}

        <LearnerPaymentsList initial={claims} initialRefunds={refunds} />
      </div>
    </>
  )
}
