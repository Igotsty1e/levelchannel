import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import type { ReactNode } from 'react'

import { SiteHeader } from '@/components/site-header'
import { listAccountRoles } from '@/lib/auth/accounts'
import { SESSION_COOKIE_NAME, lookupSession } from '@/lib/auth/sessions'

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
        {children}
      </main>
    </>
  )
}
