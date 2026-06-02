import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { SESSION_COOKIE_NAME, lookupSession } from '@/lib/auth/sessions'
import {
  countActivePackagesByTeacher,
  listPackagesByTeacher,
} from '@/lib/billing/packages'
import { resolveTeacherWriteCaps } from '@/lib/billing/teacher-subscription'

import { TeacherPackagesEditor } from './client'

// SAAS-PIVOT Epic 3 Day 4 (2026-05-22) — teacher-owned packages catalog
// surface. SSR list filtered by current teacher's id; the parent
// `app/teacher/layout.tsx` is the security gate (auth + role +
// verified-email + admin-precedence). This file trusts it and reads
// the session a second time only to surface teacherId to the data
// fetch (mirrors the pattern at app/teacher/page.tsx).
//
// Free-tier 1pkg+1tariff unlock (2026-06-02). Plan:
// docs/plans/free-tier-1pkg-1tariff-unlock.md §4 (UI data contract).
// SSR threads `writeCap` (number, 0/1/Infinity) + `currentActiveCount`
// (number, count of is_active=true AND deleted_at IS NULL packages) into
// the client editor so it can show the capacity hint, hide the create
// form at cap, and surface the "Лимит исчерпан" message. After create/
// archive the editor calls router.refresh() to re-pull caps.

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

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

  const [packages, caps, currentActiveCount] = await Promise.all([
    listPackagesByTeacher(current.account.id),
    resolveTeacherWriteCaps(current.account.id),
    countActivePackagesByTeacher(current.account.id),
  ])
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

  // `writeCap` semantics for the client: -1 = unlimited (we can't
  // serialize Infinity through the Next.js RSC boundary cleanly), >=0
  // = literal cap. Client uses Number.isFinite-equivalent check via
  // `writeCap < 0` for the "unlimited" branch.
  const writeCap = Number.isFinite(caps.maxPackages) ? caps.maxPackages : -1

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
      <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 8 }}>
        Пакеты уроков
      </h1>
      <p
        style={{
          color: 'var(--secondary)',
          fontSize: 13,
          marginBottom: 20,
          lineHeight: 1.6,
        }}
      >
        Каталог пакетов уроков, которые вы выпускаете. После первой
        покупки цена, длительность и количество занятий фиксируются —
        чтобы поменять, создайте новый пакет и архивируйте старый.
      </p>
      <TeacherPackagesEditor
        initialPackages={view}
        writeCap={writeCap}
        currentActiveCount={currentActiveCount}
      />
    </>
  )
}
