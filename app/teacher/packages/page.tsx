import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { PackagesVsTariffsExplainer } from '@/components/onboarding/packages-vs-tariffs-explainer'
import { PackageList } from '@/components/teacher/pricing/package-list'
import { SESSION_COOKIE_NAME, lookupSession } from '@/lib/auth/sessions'
import {
  countActivePackagesByTeacher,
  listPackagesByTeacher,
} from '@/lib/billing/packages'
import { resolveTeacherWriteCaps } from '@/lib/billing/teacher-subscription'
import { getOnboardingState } from '@/lib/onboarding/state'

// /teacher/packages — «Пакеты».
//
// Component tree (DEEP UX redesign, 2026-06-07):
//   <TeacherPackagesPage> (SSR)
//   ├─ back-to-settings link
//   ├─ <h1>Пакеты</h1> + sub
//   ├─ <PackagesVsTariffsExplainer> — onboarding card (empty-state only)
//   └─ <PackageList>                  — client island (cards + modal + FAB)
//
// Server-side immutability rules unchanged: economic fields (count,
// duration_minutes, amount_kopecks, currency) are frozen after the
// first purchase by `lesson_packages_economic_fields_immutable`
// trigger (mig 0033); the route pre-rejects any body that names them.
// Edit UI surfaces this as a one-line note inside the expand-on-tap
// edit panel, not as a separate banner.

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const metadata = {
  title: 'Пакеты — LevelChannel',
  robots: { index: false, follow: false },
}

export default async function TeacherPackagesPage() {
  const cookieStore = await cookies()
  const cookieValue = cookieStore.get(SESSION_COOKIE_NAME)?.value ?? null
  if (!cookieValue) {
    redirect('/login')
  }
  const current = await lookupSession(cookieValue)
  if (!current) {
    redirect('/login')
  }

  const [packages, caps, currentActiveCount, onboardingState] =
    await Promise.all([
      listPackagesByTeacher(current.account.id),
      resolveTeacherWriteCaps(current.account.id),
      countActivePackagesByTeacher(current.account.id),
      getOnboardingState(current.account.id),
    ])
  const explainerDismissed =
    'packages_vs_tariffs_explainer' in onboardingState.dismissedHints
  const hasAnyPackage = packages.length > 0 || currentActiveCount > 0
  const view = packages.map((p) => ({
    id: p.id,
    slug: p.slug,
    titleRu: p.titleRu,
    descriptionRu: p.descriptionRu,
    durationMinutes: p.durationMinutes,
    count: p.count,
    amountKopecks: p.amountKopecks,
    currency: p.currency,
    isActive: p.isActive,
    displayOrder: p.displayOrder,
  }))

  const writeCap = Number.isFinite(caps.maxPackages) ? caps.maxPackages : -1

  return (
    <div className="pricing-page">
      <div className="pricing-page-back">
        <a href="/teacher/settings" className="pricing-back-link">
          ← Назад в настройки
        </a>
      </div>
      <header className="pricing-page-header">
        <h1 className="pricing-page-title">Пакеты</h1>
        <p className="pricing-page-sub">
          Готовые пакеты по N занятий, которые ученик покупает заранее. После
          первой покупки цену, длительность и количество занятий поменять
          нельзя — создайте новый и архивируйте старый.
        </p>
      </header>
      <PackagesVsTariffsExplainer
        hasPackage={hasAnyPackage}
        dismissed={explainerDismissed}
      />
      <PackageList
        initialPackages={view}
        writeCap={writeCap}
        currentActiveCount={currentActiveCount}
      />
    </div>
  )
}
