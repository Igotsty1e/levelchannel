import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import type { ReactNode } from 'react'

import { SiteHeader } from '@/components/site-header'
import { TeacherCabinetNav } from '@/components/teacher/cabinet-nav'
import { listAccountRoles } from '@/lib/auth/accounts'
import { evaluateSaasOfferGate } from '@/lib/auth/guards'
import { SESSION_COOKIE_NAME, lookupSession } from '@/lib/auth/sessions'
import { isCalendarConnected } from '@/lib/calendar/derive-status'
import { getGoogleIntegrationMeta } from '@/lib/calendar/integrations'

// Wave A PR4 — teacher-facing calendar surface gate.
//
// Auth matrix mirrors `requireTeacherAndVerified` at SSR layer:
//   - anonymous              → /login
//   - unverified e-mail      → /cabinet (existing verify banner UX)
//   - admin (hybrid or pure) → /admin/slots (admin precedence per
//                              `pickActiveCalendarRole`)
//   - no teacher role        → /cabinet (don't surface /teacher to
//                              learners; same posture as /admin)
//   - teacher (verified)     → render
//
// We do NOT redirect a hybrid teacher+learner — the secondary learner
// role doesn't conflict with the calendar surface, and they reach the
// learner UI through /cabinet anyway.

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const metadata = {
  title: 'Учительский календарь — LevelChannel',
}

export default async function TeacherLayout({
  children,
}: {
  children: ReactNode
}) {
  const cookieStore = await cookies()
  const cookieValue = cookieStore.get(SESSION_COOKIE_NAME)?.value ?? null

  if (!cookieValue) {
    redirect('/login')
  }
  const current = await lookupSession(cookieValue)
  if (!current) {
    redirect('/login')
  }
  if (!current.account.emailVerifiedAt) {
    redirect('/cabinet')
  }

  const roles = await listAccountRoles(current.account.id)
  if (roles.includes('admin')) {
    redirect('/admin/slots')
  }
  if (!roles.includes('teacher')) {
    redirect('/cabinet')
  }

  // SAAS-OFFER A1 follow-up (2026-05-31) — SSR consent-gate hookup.
  // Sub-A.2 deferred this with BLOCKER#2 to avoid non-uniform
  // perimeter. A1 ships SSR redirect; 24-route swap + register flow
  // + backfill script идут отдельным PR (A1.1). Pragmatic safety:
  // SAAS_OFFER_GATE_ENABLED OFF by default, so unhooked /api/teacher/**
  // route surface остаётся gate-blind при flag=0 (текущее prod-
  // состояние). При операторской флипа на 1, SSR cabinet entry
  // редиректит non-consenting teachers на /saas-offer-accept; API
  // routes остаются открытыми до A1.1 (это known gap, документирован
  // в plan-doc A1.1 scope).
  const saasOfferVerdict = await evaluateSaasOfferGate(current.account.id)
  if (saasOfferVerdict.kind === 'awaiting_publication') {
    redirect('/saas-offer-awaiting')
  }
  if (saasOfferVerdict.kind === 'consent_required') {
    redirect('/saas-offer-accept')
  }

  // SSR-derived calendar connection state for the top cabinet nav's
  // Календарь dot. Centralized via isCalendarConnected (same predicate
  // as the state-aware copy on the settings page).
  const integration = await getGoogleIntegrationMeta(current.account.id)
  const calendarConnected = isCalendarConnected(integration)

  return (
    <>
      <SiteHeader />
      <main
        className="teacher-cabinet-main saas-chrome"
        data-cabinet="teacher"
        style={{
          minHeight: 'calc(100vh - 56px)',
          background: 'var(--bg)',
        }}
      >
        <TeacherCabinetNav calendarConnected={calendarConnected} />
        <div className="teacher-cabinet-inner">{children}</div>
      </main>
    </>
  )
}
