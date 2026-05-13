import { listAllTariffs } from '@/lib/pricing/tariffs'

import { TariffEditor } from './tariff-editor'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export default async function AdminPricingPage() {
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
        ученик заплатит за это занятие, а также как оно списывается
        из активного пакета. Деактивированный тариф остаётся у тех
        слотов, к которым уже был привязан, но скрывается в новых формах.
      </p>
      <TariffEditor initialTariffs={tariffs} />
    </>
  )
}
