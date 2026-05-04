import { listAccountsByRole } from '@/lib/auth/accounts'
import { listActiveTariffs } from '@/lib/pricing/tariffs'
import { listAllSlotsForAdmin } from '@/lib/scheduling/slots'

import { SlotsManager } from './slots-manager'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export default async function AdminSlotsPage() {
  const [teachers, slots, tariffs] = await Promise.all([
    listAccountsByRole('teacher'),
    listAllSlotsForAdmin({ status: 'all', limit: 200 }),
    listActiveTariffs(),
  ])

  return (
    <>
      <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 8 }}>
        Слоты
      </h1>
      <p
        style={{
          color: 'var(--secondary)',
          fontSize: 13,
          marginBottom: 20,
          lineHeight: 1.6,
        }}
      >
        Слоты — это «время + учитель + опционально тариф». Тариф нужен,
        если хотите чтобы учащийся мог оплатить через кабинет — без
        тарифа платёж операторский (через DM / прямой <code>/checkout</code>).
      </p>
      <SlotsManager
        initialTeachers={teachers}
        initialSlots={slots}
        initialTariffs={tariffs.map((t) => ({
          id: t.id,
          slug: t.slug,
          titleRu: t.titleRu,
          amountKopecks: t.amountKopecks,
        }))}
      />
    </>
  )
}
