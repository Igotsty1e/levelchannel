import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { SESSION_COOKIE_NAME, lookupSession } from '@/lib/auth/sessions'
import { listTariffsForTeacher } from '@/lib/pricing/tariffs'

import { TeacherTariffEditor } from './tariff-editor'

// SAAS-PIVOT Epic 2 Day 3 — teacher-owned tariffs CRUD page.
//
// Plan: docs/plans/saas-pivot-master.md §3 Epic 2 + §5 Day 3.
//
// Security model:
//   - Outer /teacher layout already gates: anonymous → /login, hybrid
//     admin → /admin/slots, non-teacher → /cabinet, unverified-email
//     → /cabinet. This page re-reads the session ONLY to surface the
//     teacher's account id to the data layer (NOT a security gate).
//   - All mutations go through /api/teacher/tariffs[/[id]] which gates
//     with requireTeacherAndVerified + uses guard.account.id (NOT the
//     body) as the teacher_id. Anti-spoof at every write.
//
// What the editor renders:
//   - Active tariffs (deleted_at IS NULL): list + inline edit.
//   - "Show archived" toggle reveals deleted_at IS NOT NULL rows
//     (read-only — restoring an archive is out of scope for Day 3).
//   - "Create new" form at the bottom.

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const metadata = {
  title: 'Мои тарифы — LevelChannel',
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

  const tariffs = await listTariffsForTeacher(current.account.id, {
    includeArchived: showArchived,
  })

  return (
    <>
      <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 8 }}>
        Мои тарифы
      </h1>
      <p
        style={{
          color: 'var(--secondary)',
          fontSize: 13,
          marginBottom: 20,
          lineHeight: 1.6,
        }}
      >
        Каждый тариф — это стоимость одного занятия фиксированной
        длительности. После того как тариф привязан хотя бы к одному
        слоту, изменить его цену и длительность нельзя — заведите
        новый тариф. Архивирование скрывает тариф из форм создания
        слотов, но не удаляет историю — слоты с архивным тарифом
        продолжают видеть его название и цену в журнале.
      </p>
      <TeacherTariffEditor
        initialTariffs={tariffs}
        showArchived={showArchived}
      />
    </>
  )
}
