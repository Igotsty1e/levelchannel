import {
  listAccountsByRole,
  listLearnerCandidates,
} from '@/lib/auth/accounts'
import { listActiveTariffs } from '@/lib/pricing/tariffs'
import { listAllSlotsForAdmin } from '@/lib/scheduling/slots'

import { SlotsViewSwitcher } from './slots-view-switcher'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export default async function AdminSlotsPage() {
  const [teachers, slots, tariffs, learners] = await Promise.all([
    listAccountsByRole('teacher'),
    listAllSlotsForAdmin({ status: 'all', limit: 200 }),
    listActiveTariffs(),
    listLearnerCandidates(),
  ])

  return (
    <>
      <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 8 }}>
        Занятия
      </h1>
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
