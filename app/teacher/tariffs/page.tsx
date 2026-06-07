import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { TariffFirstCreateHint } from '@/components/onboarding/tariff-first-create-hint'
import { TariffList } from '@/components/teacher/pricing/tariff-list'
import { SESSION_COOKIE_NAME, lookupSession } from '@/lib/auth/sessions'
import { resolveTeacherWriteCaps } from '@/lib/billing/teacher-subscription'
import { getOnboardingState } from '@/lib/onboarding/state'
import {
  countActiveTariffsForTeacher,
  listTariffsForTeacher,
} from '@/lib/pricing/tariffs'

// /teacher/tariffs — «Цены».
//
// Component tree (DEEP UX redesign, 2026-06-07):
//   <TeacherTariffsPage> (SSR)
//   ├─ back-to-settings link
//   ├─ <h1>Цены</h1> + sub
//   ├─ <TariffFirstCreateHint>      — onboarding card (empty-state only)
//   └─ <TariffList>                  — client island (cards + modal + FAB)
//
// All interactive UI is read-by-default; tap a card to expand to an
// inline edit form. The previous always-on table view is gone —
// admin paradigm, not the tutor's.
//
// Security model unchanged: outer /teacher layout gates auth + role +
// verified-email; this page re-reads the session ONLY to surface the
// teacher account id to the data layer. All mutations are routed via
// /api/teacher/tariffs[/[id]] with `teacher_id` bound from session, so
// the body never carries account ids.

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const metadata = {
  title: 'Цены — LevelChannel',
  robots: { index: false, follow: false },
}

type SearchParams = { params?: never; searchParams: Promise<{ archived?: string }> }

export default async function TeacherTariffsPage({ searchParams }: SearchParams) {
  const cookieStore = await cookies()
  const cookieValue = cookieStore.get(SESSION_COOKIE_NAME)?.value ?? null
  if (!cookieValue) redirect('/login')
  const current = await lookupSession(cookieValue)
  if (!current) redirect('/login')

  const sp = await searchParams
  const showArchived = sp.archived === '1'

  const [tariffs, caps, currentActiveCount, onboardingState] = await Promise.all([
    listTariffsForTeacher(current.account.id, {
      includeArchived: showArchived,
    }),
    resolveTeacherWriteCaps(current.account.id),
    countActiveTariffsForTeacher(current.account.id),
    getOnboardingState(current.account.id),
  ])
  const tariffHintDismissed =
    'tariff_first_create_hint' in onboardingState.dismissedHints
  const hasAnyTariff = tariffs.length > 0 || currentActiveCount > 0

  // Free-tier 1pkg+1tariff unlock (2026-06-02). Plan:
  // docs/plans/free-tier-1pkg-1tariff-unlock.md §4. `-1 = unlimited`
  // wire format (we can't ship Infinity through the RSC boundary).
  const writeCap = Number.isFinite(caps.maxTariffs) ? caps.maxTariffs : -1

  return (
    <div className="pricing-page">
      <div className="pricing-page-back">
        <a href="/teacher/settings" className="pricing-back-link">
          ← Назад в настройки
        </a>
      </div>
      <header className="pricing-page-header">
        <h1 className="pricing-page-title">Цены</h1>
        <p className="pricing-page-sub">
          Стоимость одиночных занятий для учеников на постоплате. Когда цена
          встанет в проведённое занятие, поменять её нельзя — создайте новую
          и архивируйте старую.
        </p>
      </header>
      {/* Onboarding hint — auto-hides once the first tariff exists. */}
      <TariffFirstCreateHint
        hasTariff={hasAnyTariff}
        dismissed={tariffHintDismissed}
      />
      <TariffList
        initialTariffs={tariffs}
        showArchived={showArchived}
        writeCap={writeCap}
        currentActiveCount={currentActiveCount}
      />
    </div>
  )
}
