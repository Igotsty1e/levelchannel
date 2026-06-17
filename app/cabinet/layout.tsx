import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import type { ReactNode } from 'react'

import { LearnerCabinetNav } from '@/components/cabinet/learner-cabinet-nav'
import { SiteHeader } from '@/components/site-header'
import { listAccountRoles } from '@/lib/auth/accounts'
import { SESSION_COOKIE_NAME, lookupSession } from '@/lib/auth/sessions'

// 2026-06-17 — learner cabinet shell. Аналог /teacher/layout.tsx.
//
// Цель: единый top/bottom nav для всех учеников + auth guard.
//
// Auth matrix:
//   - anonymous     → /login
//   - teacher only  → /teacher (тот же подход что admin precedence)
//   - learner / hybrid → render
//
// Hybrid learner+teacher шлём в /teacher по умолчанию НЕТ — это нарушит
// существующее поведение «/cabinet работает для всех». Просто рендерим.

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export default async function LearnerCabinetLayout({
  children,
}: {
  children: ReactNode
}) {
  const cookieStore = await cookies()
  const cookieValue = cookieStore.get(SESSION_COOKIE_NAME)?.value ?? null
  if (!cookieValue) redirect('/login')
  const current = await lookupSession(cookieValue)
  if (!current) redirect('/login')

  // Не редиректим pure-teacher автоматически — /cabinet может быть точкой
  // входа из старых писем. Им показывается контент когда они в нём (всё
  // равно есть guards на конкретных секциях через `isLearner`).
  const roles = await listAccountRoles(current.account.id)
  void roles

  return (
    <>
      <SiteHeader />
      <main
        className="learner-cabinet-main saas-chrome"
        data-cabinet="learner"
        style={{
          minHeight: 'calc(100vh - 56px)',
          background: 'var(--bg)',
        }}
      >
        <LearnerCabinetNav />
        <div className="learner-cabinet-inner">{children}</div>
      </main>
    </>
  )
}
