import { getDbPool } from '@/lib/db/pool'

import { PackagesEditor } from './packages-editor'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Billing wave PR 4 — admin packages catalog. Operator manages the
// list of buyable packages (10×60 min, 5×90 min, etc.). Economic
// fields (amount_kopecks, duration_minutes, count) are immutable
// once any purchase references the row — the operator path on
// price change is "deactivate old + create new". The DB trigger
// installed by migration 0033 enforces this; the admin UI here
// only ships the CREATE + soft-archive flow.

type AdminPackage = {
  id: string
  slug: string
  titleRu: string
  descriptionRu: string | null
  durationMinutes: number
  count: number
  amountKopecks: number
  currency: string
  isActive: boolean
  displayOrder: number
  hasPurchases: boolean
}

async function loadPackagesWithPurchaseFlag(): Promise<AdminPackage[]> {
  const pool = getDbPool()
  const result = await pool.query(
    `select pkg.id, pkg.slug, pkg.title_ru, pkg.description_ru,
            pkg.duration_minutes, pkg.count, pkg.amount_kopecks, pkg.currency,
            pkg.is_active, pkg.display_order,
            exists (select 1 from package_purchases pp where pp.package_id = pkg.id) as has_purchases
       from lesson_packages pkg
      order by pkg.is_active desc, pkg.display_order asc, pkg.id asc`,
  )
  return result.rows.map((r) => ({
    id: String(r.id),
    slug: String(r.slug),
    titleRu: String(r.title_ru),
    descriptionRu: r.description_ru ? String(r.description_ru) : null,
    durationMinutes: Number(r.duration_minutes),
    count: Number(r.count),
    amountKopecks: Number(r.amount_kopecks),
    currency: String(r.currency),
    isActive: Boolean(r.is_active),
    displayOrder: Number(r.display_order),
    hasPurchases: Boolean(r.has_purchases),
  }))
}

export default async function AdminPackagesPage() {
  const packages = await loadPackagesWithPurchaseFlag()
  return (
    <>
      <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 8 }}>
        Пакеты
      </h1>
      <p
        style={{
          color: 'var(--secondary)',
          fontSize: 13,
          marginBottom: 20,
          lineHeight: 1.6,
        }}
      >
        Каталог покупаемых учениками пакетов. После первой покупки
        экономические поля (цена, длительность, количество) становятся
        неизменяемыми. Чтобы изменить цену — деактивируйте старый
        пакет и создайте новый.
      </p>
      <PackagesEditor initialPackages={packages} />
    </>
  )
}
