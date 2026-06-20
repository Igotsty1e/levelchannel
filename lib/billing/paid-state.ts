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

// post-deploy bug bash 2026-06-19 (Bug 5): batch версия для teacher
// lesson history pill «Оплачено».
//
// Возвращает per-slot payment source:
//   • 'paid_package' — есть active package_consumption (restored_at IS NULL)
//   • 'paid_direct'  — direct allocation покрывает expected_amount_kopecks
//                       и не fully refunded
//   • 'unpaid'       — slot booked, но без покрытия
//   • null           — для не-booked statuses (cancelled / completed / etc)
//
// Precedence: package > direct > unpaid. SQL mirrors `slotIsPaidByAllocations`
// для direct branch (paid order + reversals < amount) и `package_consumptions`
// active filter для package branch.

export type SlotPaymentSource = 'paid_package' | 'paid_direct' | 'unpaid' | null

export async function getSlotPaymentSources(
  slotIds: string[],
): Promise<Map<string, SlotPaymentSource>> {
  const result = new Map<string, SlotPaymentSource>()
  if (slotIds.length === 0) return result

  const pool = getDbPool()
  // post-deploy bug bash 2026-06-19 (round-3 fix): payment_allocations.target_id
  // имеет тип TEXT (mig 0022). Cast `target_id::uuid` валит на rows с
  // kind != 'lesson_slot' где target_id не UUID — Postgres evaluates
  // predicates row-by-row без short-circuit gauarantee. Решение: сравниваем
  // через text (slot.id::text) как делает существующий slotIsPaidByAllocations.
  // Два параметра: $1 = uuid[] для lesson_slots/package_consumptions,
  // $2 = text[] для payment_allocations.target_id.
  const slotIdsText = slotIds.map((id) => String(id))
  const rows = await pool.query<{
    slot_id: string
    status: string
    has_package: boolean
    has_direct: boolean
  }>(
    `with active_packages as (
       select pc.slot_id
         from package_consumptions pc
        where pc.slot_id = any($1::uuid[])
          and pc.restored_at is null
     ),
     direct_paid as (
       select a.target_id as slot_id_text
         from payment_allocations a
         join payment_orders o
              on o.invoice_id = a.payment_order_id and o.status = 'paid'
         left join lateral (
           select coalesce(sum(refunded_kopecks), 0)::bigint as refunded_sum
             from payment_allocation_reversals r
            where r.payment_order_id = a.payment_order_id
              and r.kind = a.kind
              and r.target_id = a.target_id
         ) rev on true
        where a.kind = 'lesson_slot'
          and a.target_id = any($2::text[])
          and coalesce(rev.refunded_sum, 0) < a.amount_kopecks
     )
     select s.id::text as slot_id,
            s.status,
            exists(select 1 from active_packages ap where ap.slot_id = s.id) as has_package,
            exists(select 1 from direct_paid dp where dp.slot_id_text = s.id::text) as has_direct
       from lesson_slots s
      where s.id = any($1::uuid[])`,
    [slotIds, slotIdsText],
  )

  for (const row of rows.rows) {
    let source: SlotPaymentSource = null
    if (row.has_package) {
      source = 'paid_package'
    } else if (row.has_direct) {
      source = 'paid_direct'
    } else if (row.status === 'booked') {
      source = 'unpaid'
    }
    result.set(row.slot_id, source)
  }
  return result
}

