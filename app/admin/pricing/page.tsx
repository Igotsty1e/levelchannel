import { listAllTariffs } from '@/lib/pricing/tariffs'

import { TariffEditor } from './tariff-editor'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export default async function AdminPricingPage() {
  const tariffs = await listAllTariffs()
  return (
    <>
      <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 8 }}>Тарифы</h1>
      <p
        style={{
          color: 'var(--secondary)',
          fontSize: 13,
          marginBottom: 20,
          lineHeight: 1.6,
        }}
      >
        Каталог управляется здесь. Публичная страница{' '}
        <code>/pay</code> в этой волне остаётся со свободной суммой; подключение
        каталога к чекауту запланировано в Phase 6 (см. ENGINEERING_BACKLOG.md).
      </p>
      <TariffEditor initialTariffs={tariffs} />
    </>
  )
}
