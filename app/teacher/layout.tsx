import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import type { ReactNode } from 'react'

import { SiteHeader } from '@/components/site-header'
import { TeacherCabinetNav } from '@/components/teacher/cabinet-nav'
import { listAccountRoles } from '@/lib/auth/accounts'
import { SESSION_COOKIE_NAME, lookupSession } from '@/lib/auth/sessions'
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

  // SAAS-OFFER bundle Sub-A.2 round-1 BLOCKER#2 closure (2026-05-30) —
  // the SSR consent-gate hookup is DELIBERATELY DEFERRED to the
  // follow-up Sub-A.3/A.5 PR that also ships the /api/teacher/** route
  // swap, register-flow refactor, and backfill script. Wiring the gate
  // here without the perimeter would leave a non-uniform enforcement
  // surface: cabinet SSR would redirect non-consenting teachers to
  // /saas-offer-accept while teacher API mutations stayed open. The
  // SAAS_OFFER_GATE_ENABLED operator setting ships in this PR for the
  // standalone /saas-offer-accept and /saas-offer-awaiting routes only
  // (they evaluate the gate before rendering); the cabinet entry stays
  // gate-blind until the perimeter is complete.

  // Sub-PR B (TASK-1) — SSR-derived calendar connection state for the
  // top cabinet nav's Календарь dot. Source of truth = same predicate
  // the inline status row used (`syncState ∈ ('active','degraded')`).
  // Disconnected / null / errored row → dot shows "○ not connected".
  const integration = await getGoogleIntegrationMeta(current.account.id)
  const calendarConnected =
    integration?.syncState === 'active'
    || integration?.syncState === 'degraded'

  return (
    <>
      <SiteHeader />
      <main
        style={{
          minHeight: 'calc(100vh - 56px)',
          background: 'var(--bg)',
          padding: '32px 40px 96px',
        }}
      >
        <TeacherCabinetNav calendarConnected={calendarConnected} />
        {children}
      </main>
    </>
  )
}
