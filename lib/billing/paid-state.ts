// Billing wave PR 1 — derived "is this slot postpaid-paid?" state.
//
// Codex round 2 HIGH 1 of the design loop pinned the SQL: SUM must
// be CASE-filtered on `payment_orders.status = 'paid'` so allocations
// attached to pending/failed/cancelled orders contribute 0. Without
// the filter, a stale pending allocation would inflate the paid total
// and falsely flip the slot to "paid".
//
// Refund Phase 7 Stage A: the `payment_allocation_reversals` LEFT JOIN
// is wired so reversed allocations subtract from the paid total. This
// is the single point of truth for the derived "is this slot paid?"
// answer.
//
// Wave 54 — partial reversals. Multiple reversal rows per allocation
// are now valid; pre-aggregate refunded_sum per allocation (LATERAL)
// and subtract it from a.amount_kopecks. The CASE keeps "no paid
// order" rows at 0; GREATEST against 0 guards a SUM that exceeds the
// allocation (shouldn't happen — admin endpoint asserts — but defense
// in depth never hurts here).

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
                   then greatest(a.amount_kopecks - coalesce(rev.refunded_sum, 0), 0)
                   else 0
              end
            ), 0)::bigint as paid_amount_kopecks
       from lesson_slots s
       left join pricing_tariffs t on t.id = s.tariff_id
       left join payment_allocations a
              on a.kind = 'lesson_slot' and a.target_id = s.id::text
       left join payment_orders o
              on o.invoice_id = a.payment_order_id and o.status = 'paid'
       left join lateral (
         select coalesce(sum(refunded_kopecks), 0)::bigint as refunded_sum
           from payment_allocation_reversals r
          where r.payment_order_id = a.payment_order_id
            and r.kind = a.kind
            and r.target_id = a.target_id
       ) rev on true
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

