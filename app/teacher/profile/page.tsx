import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { ProfileEditor } from '@/app/cabinet/profile-editor'
import {
  TariffComparisonCard,
  type TariffComparisonPlan,
} from '@/components/teacher/tariff-comparison-card'
import { getAccountProfile } from '@/lib/auth/profiles'
import { SESSION_COOKIE_NAME, lookupSession } from '@/lib/auth/sessions'
import { getDbPool } from '@/lib/db/pool'

// Teacher cabinet polish — Sub-PR C (TASK-2).
//
// Plan: docs/plans/teacher-cabinet-polish.md §3 Sub-PR C.
//
// Server-rendered teacher profile surface. Surfaces:
//   1. `<TariffComparisonCard />` — 4 plan cards (free / mid / pro /
//      operator-managed); the current plan gets a "● Текущий тариф"
//      badge; all "Сменить тариф" buttons are disabled (Epic 4 plan-
//      flip is still deferred).
//   2. `<ProfileEditor />` reused from /cabinet/profile — same UX for
//      display_name + timezone. NO duplicate UI; Sub-PR F (out of
//      scope here) is where the editor grows firstName/lastName.
//
// Security model:
//   - Outer /teacher layout already gates: anonymous → /login, admin →
//     /admin/slots, non-teacher → /cabinet, unverified-email → /cabinet.
//     This page re-reads the session ONLY to surface the teacher's own
//     account.id to the data layer (NOT a security gate).
//   - All reads are scoped to `session.account.id`; no body input
//     selects the teacher (anti-spoof per plan §3 Sub-PR C).
//   - Tariff plans are catalogue rows (4 hard-coded rows from mig
//     0073); reading them surfaces no PII.
//
// Subscription row absence: a teacher without a `teacher_subscriptions`
// row is rare (mig 0083 + the /register?role=teacher route both insert
// one). For defensive UX, fall back to `'free'` so the Free card gets
// the badge — same posture as the formatProfileName fallback chain.

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const metadata = {
  title: 'Профиль — LevelChannel',
  robots: { index: false, follow: false },
}

const PLAN_SLUG_FALLBACK = 'free'

async function loadTariffPlans(): Promise<TariffComparisonPlan[]> {
  const pool = getDbPool()
  const result = await pool.query<{
    slug: string
    title_ru: string
    price_kopecks_monthly: number
    learner_limit: number | null
    features: Record<string, unknown> | null
  }>(
    `select slug, title_ru, price_kopecks_monthly, learner_limit, features
       from teacher_subscription_plans
      order by price_kopecks_monthly asc, slug asc`,
  )
  return result.rows.map((row) => ({
    slug: row.slug,
    titleRu: row.title_ru,
    priceKopecksMonthly: Number(row.price_kopecks_monthly),
    learnerLimit:
      row.learner_limit === null ? null : Number(row.learner_limit),
    features: row.features ?? {},
  }))
}

async function loadCurrentPlanSlug(teacherAccountId: string): Promise<string> {
  const pool = getDbPool()
  const result = await pool.query<{ plan_slug: string }>(
    `select plan_slug
       from teacher_subscriptions
      where account_id = $1::uuid
      limit 1`,
    [teacherAccountId],
  )
  return result.rows[0]?.plan_slug ?? PLAN_SLUG_FALLBACK
}

export default async function TeacherProfilePage() {
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

  // Three independent reads — fire concurrently. None of them depend on
  // each other (plans + subscription + profile all key off the
  // already-resolved account.id).
  const [plans, currentPlanSlug, profile] = await Promise.all([
    loadTariffPlans(),
    loadCurrentPlanSlug(account.id),
    getAccountProfile(account.id),
  ])

  return (
    <>
      <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 16 }}>
        Профиль
      </h1>
      <TariffComparisonCard
        plans={plans}
        currentPlanSlug={currentPlanSlug}
      />
      <ProfileEditor initialProfile={profile} fallbackEmail={account.email} />
    </>
  )
}
