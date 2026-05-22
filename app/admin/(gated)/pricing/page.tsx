import { listAllTariffs } from '@/lib/pricing/tariffs'

import { TariffEditor } from './tariff-editor'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export default async function AdminPricingPage() {
  // teacher-scope: admin-global — operator sees every teacher's
  // catalogue here (Epic 6 will add a teacher-filter chip). Soft-
  // deleted tariffs hidden by default; the route accepts
  // ?includeArchived=1 for the audit view but this SSR shell keeps
  // the active-only view for now.
  const tariffs = await listAllTariffs()
  return (
    <>
      <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 8 }}>
        Тарифы за одно занятие
      </h1>
      <p
        style={{
          color: 'var(--secondary)',
          fontSize: 13,
          marginBottom: 20,
          lineHeight: 1.6,
        }}
      >
        Стоимость одного урока разной длительности (60 / 90 минут).
        Тариф привязывается к слоту при создании и определяет, сколько
        ученик оплатит за это занятие, а также как оно списывается
        из активного пакета. Деактивированный тариф остаётся у тех
        слотов, к которым уже был привязан, но скрывается в новых формах.
      </p>
      <TariffEditor initialTariffs={tariffs} />
    </>
  )
}
