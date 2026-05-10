// Billing wave PR 1 — derived "is this slot postpaid-paid?" state.
//
// Codex round 2 HIGH 1 of the design loop pinned the SQL: SUM must
// be CASE-filtered on `payment_orders.status = 'paid'` so allocations
// attached to pending/failed/cancelled orders contribute 0. Without
// the filter, a stale pending allocation would inflate the paid total
// and falsely flip the slot to "paid".
//
// The future refund wave will plug in a `payment_allocation_reversals`
// LEFT JOIN with `r.id IS NULL` to subtract reversed allocations. This
// helper is the single point of truth — when refunds land, this is
// where the change goes.

import { getDbPool } from '@/lib/db/pool'

export type SlotPaidStatus = {
  slotId: string
  expectedAmountKopecks: number | null
  paidAmountKopecks: number
  isPaid: boolean
}

// Returns paid state for a single slot. `expectedAmountKopecks` is
// null when the slot has no `tariff_id` (legacy / operator-priced
// slot); `isPaid` is then false for the postpaid surface (operator
// reconciles manually).
export async function slotIsPaidByAllocations(
  slotId: string,
): Promise<SlotPaidStatus | null> {
  const pool = getDbPool()
  const result = await pool.query(
    `select s.id as slot_id,
            t.amount_kopecks as expected_amount_kopecks,
            coalesce(sum(
              case when o.invoice_id is not null
                   then a.amount_kopecks
                   else 0
              end
            ), 0)::bigint as paid_amount_kopecks
       from lesson_slots s
       left join pricing_tariffs t on t.id = s.tariff_id
       left join payment_allocations a
              on a.kind = 'lesson_slot' and a.target_id = s.id::text
       left join payment_orders o
              on o.invoice_id = a.payment_order_id and o.status = 'paid'
      where s.id = $1
      group by s.id, t.amount_kopecks`,
  [slotId],
  )
  if (result.rows.length === 0) return null
  const row = result.rows[0]
  const expected =
    row.expected_amount_kopecks !== null && row.expected_amount_kopecks !== undefined
      ? Number(row.expected_amount_kopecks)
      : null
  const paid = Number(row.paid_amount_kopecks)
  return {
    slotId: String(row.slot_id),
    expectedAmountKopecks: expected,
    paidAmountKopecks: paid,
    isPaid: expected !== null && paid >= expected,
  }
}

