import { listAccountsByRole } from '@/lib/auth/accounts'
import { listAllSlotsForAdmin } from '@/lib/scheduling/slots'

import { SlotsManager } from './slots-manager'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export default async function AdminSlotsPage() {
  const [teachers, slots] = await Promise.all([
    listAccountsByRole('teacher'),
    listAllSlotsForAdmin({ status: 'all', limit: 200 }),
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
        Слоты — это конкретное «время + учитель». Свободные видны учащимся в
        кабинете. Бронирование пока без оплаты — связь с тарифами и платежом
        приходит в Phase 6.
      </p>
      <SlotsManager initialTeachers={teachers} initialSlots={slots} />
    </>
  )
}
