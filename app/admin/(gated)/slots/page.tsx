import Link from 'next/link'

import { countAdminConflicts } from '@/lib/admin/conflict-feed'
import {
  listAccountsByRole,
  listLearnerCandidates,
} from '@/lib/auth/accounts'
import { listActiveTariffs } from '@/lib/pricing/tariffs'
import { listAllSlotsForAdmin } from '@/lib/scheduling/slots'

import { SlotsViewSwitcher } from './slots-view-switcher'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

export default async function AdminSlotsPage() {
  const [teachers, slots, tariffs, learners, conflictCount] = await Promise.all([
    listAccountsByRole('teacher'),
    listAllSlotsForAdmin({ status: 'all', limit: 200 }),
    // teacher-scope: admin-global — operator picks "as which teacher"
    // in the slot-create form, so the dropdown lists every teacher's
    // active tariffs. SAAS-PIVOT Epic 6 adds a teacher-filter chip;
    // until then admin sees the union.
    listActiveTariffs({ teacherId: null }),
    listLearnerCandidates(),
    // BCS-DEF-2 — badge for /admin/slots/conflicts. Returns null on
    // DB error so the link still renders without a count.
    countAdminConflicts({ since: new Date(Date.now() - THIRTY_DAYS_MS) }),
  ])

  return (
    <>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          marginBottom: 8,
          gap: 12,
        }}
      >
        <h1 style={{ fontSize: 24, fontWeight: 600 }}>Занятия</h1>
        <Link
          href="/admin/slots/conflicts"
          style={{
            fontSize: 13,
            color: 'var(--accent)',
            textDecoration: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          Конфликты
          {conflictCount !== null && conflictCount > 0 ? ` (${conflictCount})` : ''}
        </Link>
      </div>
      <p
        style={{
          color: 'var(--secondary)',
          fontSize: 13,
          marginBottom: 20,
          lineHeight: 1.6,
        }}
      >
        Занятие — это время в расписании учителя плюс, по желанию,
        привязанный тариф. Тариф нужен, если хотите, чтобы учащийся
        мог оплатить занятие через кабинет — без тарифа оплата идёт
        операторским способом (мессенджер или прямая ссылка на оплату).
      </p>
      <SlotsViewSwitcher
        teachers={teachers}
        initialSlots={slots}
        initialTariffs={tariffs.map((t) => ({
          id: t.id,
          slug: t.slug,
          titleRu: t.titleRu,
          amountKopecks: t.amountKopecks,
        }))}
        initialLearners={learners}
      />
    </>
  )
}
