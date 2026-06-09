// A2 — Mid/Pro teacher-subscription SSR cabinet page.
//
// Plan: docs/plans/saas-offer-and-landing-redesign.md A2.
// Polish: docs/plans/bug-4-tariff-naming-and-ui.md Sub-PR B (2026-06-02).
//
// Reads the teacher's current subscription row + the Mid/Pro catalogue,
// renders <TeacherSubscriptionClient /> with the two states (active vs
// pick-a-tier). Outer /teacher/layout.tsx already gates the session;
// here we just read the account id and dispatch.

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { SESSION_COOKIE_NAME, lookupSession } from '@/lib/auth/sessions'
import {
  SAAS_SUBSCRIPTION_TARIFFS,
  getActiveTeacherSubscription,
} from '@/lib/billing/teacher-subscription'
import { TeacherSubscriptionClient } from './client'
import { PromoCodeInput } from './promo-input'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const metadata = {
  title: 'Подписка — LevelChannel',
  robots: { index: false, follow: false },
}

export default async function TeacherSubscriptionPage() {
  const cookieStore = await cookies()
  const cookieValue = cookieStore.get(SESSION_COOKIE_NAME)?.value ?? null
  if (!cookieValue) {
    redirect('/login')
  }
  const current = await lookupSession(cookieValue)
  if (!current) {
    redirect('/login')
  }
  const { account } = current

  const row = await getActiveTeacherSubscription(account.id)

  // free-tier-saas-card-and-subscription-row plan §1 item 2 (§0a-3
  // closure): pick-tier grid now includes Стартовый (free) alongside
  // Базовый (mid) and Расширенный (pro). When the teacher has an active
  // paid sub, the active-card view below renders instead — Стартовый is
  // NOT shown in active-paid mode (the Mid teacher already exceeds free
  // caps, so showing Стартовый would be misleading).
  const tariffs = (['free', 'mid', 'pro'] as const).map((tier) => {
    const tariff = SAAS_SUBSCRIPTION_TARIFFS[tier]
    return {
      tier: tariff.tier,
      titleRu: tariff.titleRu,
      amountKopecks: tariff.amountKopecks,
      learnerLimit: tariff.learnerLimit ?? 0,
      description: tariff.description,
      features: [...tariff.features],
    }
  })

  const active =
    row?.isPaidActive && (row.planSlug === 'mid' || row.planSlug === 'pro')
      ? {
          tier: row.planSlug as 'mid' | 'pro',
          titleRu:
            row.planSlug === 'mid'
              ? SAAS_SUBSCRIPTION_TARIFFS.mid.titleRu
              : SAAS_SUBSCRIPTION_TARIFFS.pro.titleRu,
          periodEnd: row.periodEnd,
          amountKopecks: row.amountKopecks,
          cancelledAt: row.cancelledAt,
          features:
            row.planSlug === 'mid'
              ? [...SAAS_SUBSCRIPTION_TARIFFS.mid.features]
              : [...SAAS_SUBSCRIPTION_TARIFFS.pro.features],
        }
      : null

  return (
    <>
      <div style={{ marginBottom: 16 }}>
        <a
          href="/teacher/settings"
          style={{
            color: 'var(--secondary)',
            textDecoration: 'none',
            fontSize: 14,
          }}
        >
          ← Назад в настройки
        </a>
      </div>
      <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 16 }}>
        Подписка на платформу
      </h1>
      <TeacherSubscriptionClient active={active} tariffs={tariffs} />
      <PromoCodeInput />
    </>
  )
}
