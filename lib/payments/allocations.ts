import { getDbPool } from '@/lib/db/pool'

// PKG-RECON RECON.0: AllocationKind union extended to include
// 'package'. The DB row check has ALWAYS accepted 'package'
// (lib/billing/package-grant.ts:191 inserts kind='package' for
// package_purchase allocations); only the TS type was lagging.
// Round 1 WARN #10 / round 2 INFO #4 closure: all existing reads
// filtering `WHERE kind='lesson_slot'` were verified slot-only by
// intent (`lib/payments/allocations.ts:119,177`,
// `lib/billing/paid-state.ts:54`, `lib/billing/packages/debt.ts:55`).
export type AllocationKind = 'lesson_slot' | 'package'

export type PaymentAllocation = {
  paymentOrderId: string
  kind: AllocationKind
  targetId: string
  amountKopecks: number
  createdAt: string
}

const ALLOWED_KINDS = new Set<AllocationKind>(['lesson_slot', 'package'])

function rowToAllocation(row: Record<string, unknown>): PaymentAllocation {
  return {
    paymentOrderId: String(row.payment_order_id),
    kind: String(row.kind) as AllocationKind,
    targetId: String(row.target_id),
    amountKopecks: Number(row.amount_kopecks),
    createdAt: new Date(String(row.created_at)).toISOString(),
  }
}

// Best-effort recorder. Returns true on success, false when nothing
// got inserted (duplicate primary key — already recorded by an
// earlier webhook delivery — or DB unreachable). Callers do NOT need
// to check the return value; we surface it for tests.
//
// Phase 6 wave: wired into the CloudPayments Pay webhook handler
// when the order metadata carries a slotId. A failed allocation
// insert MUST NOT block webhook ack to CloudPayments — the calling
// path wraps this in try/catch.
export async function recordAllocation(params: {
  paymentOrderId: string
  kind: AllocationKind
  targetId: string
  amountKopecks: number
}): Promise<boolean> {
  if (!ALLOWED_KINDS.has(params.kind)) {
    return false
  }
  if (
    !Number.isInteger(params.amountKopecks) ||
    params.amountKopecks < 0
  ) {
    return false
  }
  const pool = getDbPool()
  try {
    const result = await pool.query(
      `insert into payment_allocations (
         payment_order_id, kind, target_id, amount_kopecks
       ) values ($1, $2, $3, $4)
       on conflict (payment_order_id, kind, target_id) do nothing`,
      [
        params.paymentOrderId,
        params.kind,
        params.targetId,
        params.amountKopecks,
      ],
    )
    return (result.rowCount ?? 0) > 0
  } catch (err) {
    console.warn('[allocations] insert failed:', {
      paymentOrderId: params.paymentOrderId,
      kind: params.kind,
      targetId: params.targetId,
      error: err instanceof Error ? err.message : String(err),
    })
    return false
  }
}

export async function listAllocationsForOrder(
  paymentOrderId: string,
): Promise<PaymentAllocation[]> {
  const pool = getDbPool()
  const result = await pool.query(
    `select payment_order_id, kind, target_id, amount_kopecks, created_at
       from payment_allocations
      where payment_order_id = $1
      order by created_at asc`,
    [paymentOrderId],
  )
  return result.rows.map(rowToAllocation)
}

// Bulk lookup the cabinet uses to render «оплачено» / «оплатить»
// next to each booked slot. Returns a map keyed by slot id; missing
// keys mean "no paid allocation found" (i.e. unpaid).
//
// Refund Phase 7. A fully-reversed allocation drops from the result
// so the cabinet returns the slot to the "оплатить" bucket. Wave 54
// partial reversals: only drop the allocation when
// SUM(refunded_kopecks) >= amount_kopecks; a partial reversal keeps
// the slot in the paid bucket (most of it was still paid).
//
// Note: this function returns ONLY currently-paid slots. The cabinet
// uses `listSlotPaymentState` instead to distinguish "paid" /
// "refunded" / "never paid" for the 3-way pill (Wave 52 + Wave 54).
export async function listSlotPaidStatus(
  slotIds: string[],
): Promise<Map<string, { paid: boolean; orderInvoiceId: string }>> {
  const out = new Map<string, { paid: boolean; orderInvoiceId: string }>()
  if (slotIds.length === 0) return out
  const pool = getDbPool()
  const result = await pool.query(
    `select a.target_id, a.payment_order_id
       from payment_allocations a
       join payment_orders o on o.invoice_id = a.payment_order_id
       left join lateral (
         select coalesce(sum(refunded_kopecks), 0)::bigint as refunded_sum
           from payment_allocation_reversals r
          where r.payment_order_id = a.payment_order_id
            and r.kind = a.kind
            and r.target_id = a.target_id
       ) rev on true
      where a.kind = 'lesson_slot'
        and o.status = 'paid'
        and coalesce(rev.refunded_sum, 0) < a.amount_kopecks
        and a.target_id = any($1)`,
    [slotIds],
  )
  for (const row of result.rows) {
    out.set(String(row.target_id), {
      paid: true,
      orderInvoiceId: String(row.payment_order_id),
    })
  }
  return out
}

// Refund Phase 7 Stage C. Richer per-slot payment state for the
// cabinet UI: distinguishes "paid" (allocation, no reversal) from
// "refunded" (allocation + reversal). Slots with no allocation are
// absent from the result map (caller treats absence as "never paid").
//
// Why two separate functions: `listSlotPaidStatus` is a hot path on
// every cabinet render; it has a narrow contract (only paid slots
// surface) and several tests pin it. Adding the refund branch as a
// second function avoids breaking that contract or its tests.
//
// Codex Wave 52 review HIGH. A single slot can have MULTIPLE
// allocations across history (e.g. paid → refunded → paid again from
// a fresh allocation). Aggregating per-slot is mandatory; a naive
// last-row-wins would silently disagree with `slotIsPaidByAllocations`
// and the debt query, which both treat "any non-reversed paid
// allocation" as paid. Use bool_or so the slot's state is `paid` if
// even one non-reversed paid allocation exists; only if EVERY paid
// allocation is reversed does the slot collapse to `refunded`.
export type SlotPaymentState = 'paid' | 'refunded'

export async function listSlotPaymentState(
  slotIds: string[],
): Promise<Map<string, SlotPaymentState>> {
  const out = new Map<string, SlotPaymentState>()
  if (slotIds.length === 0) return out
  const pool = getDbPool()
  // Wave 54 — partial reversals. An allocation is "not fully refunded"
  // when SUM(refunded_kopecks) < amount_kopecks. The slot is "paid" if
  // ANY allocation is not fully refunded; collapses to "refunded" only
  // when every allocation hit full SUM coverage.
  const result = await pool.query(
    `select a.target_id,
            bool_or(coalesce(rev.refunded_sum, 0) < a.amount_kopecks)
              as has_non_fully_refunded
       from payment_allocations a
       join payment_orders o on o.invoice_id = a.payment_order_id
       left join lateral (
         select coalesce(sum(refunded_kopecks), 0)::bigint as refunded_sum
           from payment_allocation_reversals r
          where r.payment_order_id = a.payment_order_id
            and r.kind = a.kind
            and r.target_id = a.target_id
       ) rev on true
      where a.kind = 'lesson_slot'
        and o.status = 'paid'
        and a.target_id = any($1)
      group by a.target_id`,
    [slotIds],
  )
  for (const row of result.rows) {
    out.set(
      String(row.target_id),
      Boolean(row.has_non_fully_refunded) ? 'paid' : 'refunded',
    )
  }
  return out
}
