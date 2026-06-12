// 2026-06-12 payments-copy-and-states: pure-read helper для UI-уровня
// `/cabinet`. Возвращает set ID слотов, покрытых не-restored консумпцией
// активного пакета этого ученика, чтобы UI не показывал «Оплатить» для
// уже-покрытых слотов. Чисто read-only — не дёргает invariant'ы
// `lib/billing/consumption.ts` (money-moving critical-path).

import { getDbPool } from '@/lib/db/pool'

export async function listPackageConsumedSlotIds(
  learnerAccountId: string,
): Promise<Set<string>> {
  const pool = getDbPool()
  const result = await pool.query<{ slot_id: string }>(
    `select distinct pc.slot_id
       from package_consumptions pc
       join package_purchases pp on pp.id = pc.package_purchase_id
      where pp.account_id = $1
        and pc.restored_at is null`,
    [learnerAccountId],
  )
  return new Set(result.rows.map((r) => String(r.slot_id)))
}
