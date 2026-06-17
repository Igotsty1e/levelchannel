// 2026-06-17 — учитель отметил оплату через /teacher/learners/[id]/settle
// (settleLessons), но в кабинете ученика всё ещё видна кнопка «Оплатить».
//
// Причина: paidSlotIds на /cabinet складывался из 3 источников —
// payment_allocations (CloudPayments), payment_claims, package_consumptions.
// lesson_settlement_completions НЕ учитывался.
//
// Settle-модель: учитель идёт по lesson_completions FIFO и пишет
// lesson_settlement_completions(completion_id, amount). Если сумма
// settlement_completions для completion'а покрыла amount_kopecks
// completion'а — занятие считается оплаченным.
//
// Этот helper маппит slot_id → covered? через JOIN на lesson_completions.

import { getDbPool } from '@/lib/db/pool'

export async function listSettledPaidSlotIds(
  slotIds: string[],
): Promise<Set<string>> {
  const out = new Set<string>()
  if (slotIds.length === 0) return out
  const r = await getDbPool().query<{ slot_id: string }>(
    `select lc.slot_id
       from lesson_completions lc
      where lc.slot_id = any($1::uuid[])
        and coalesce((
          select sum(lsc.amount_kopecks)::bigint
            from lesson_settlement_completions lsc
           where lsc.completion_id = lc.id
        ), 0) >= lc.amount_kopecks`,
    [slotIds],
  )
  for (const row of r.rows) out.add(String(row.slot_id))
  return out
}
