import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { SESSION_COOKIE_NAME, lookupSession } from '@/lib/auth/sessions'
import { listPackagesByTeacher } from '@/lib/billing/packages'

import { TeacherPackagesEditor } from './client'

// SAAS-PIVOT Epic 3 Day 4 (2026-05-22) — teacher-owned packages catalog
// surface. SSR list filtered by current teacher's id; the parent
// `app/teacher/layout.tsx` is the security gate (auth + role +
// verified-email + admin-precedence). This file trusts it and reads
// the session a second time only to surface teacherId to the data
// fetch (mirrors the pattern at app/teacher/page.tsx).

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

  const packages = await listPackagesByTeacher(current.account.id)
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

  return (
    <>
      <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 8 }}>
        Мои пакеты
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
        покупки экономические поля (цена, длительность, количество)
        становятся неизменяемыми. Чтобы поменять цену — деактивируйте
        старый пакет и создайте новый.
      </p>
      <TeacherPackagesEditor initialPackages={view} />
    </>
  )
}
