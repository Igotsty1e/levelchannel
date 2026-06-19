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
// are now valid. The predicate matches `listSlotPaymentState` and
// `listAccountPostpaidDebt`: an allocation contributes its full
// `amount_kopecks` while `SUM(refunded_kopecks) < amount_kopecks`,
// and 0 once the SUM hits full coverage. This binary all-or-nothing
// is the contract documented in `lib/payments/allocations.ts` —
// the four read paths must agree on "is this slot paid?" so a partial
// refund keeps the slot in the paid bucket across the entire stack.
// Codex Wave 54 review HIGH 1 flagged that a `net-covered-kopecks`
// scheme would silently disagree with the other three paths.

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
    // T3 Sub-PR B (2026-06-01) R1-WARN#2 closure: expected_amount_kopecks
    // reads booking snapshot, not live tariff. Stays aligned with
    // lib/billing/packages/debt.ts (per the SoT contract).
    `select s.id as slot_id,
            coalesce(s.snapshot_amount_kopecks, t.amount_kopecks) as expected_amount_kopecks,
            coalesce(sum(
              case when o.invoice_id is not null
                       and coalesce(rev.refunded_sum, 0) < a.amount_kopecks
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

