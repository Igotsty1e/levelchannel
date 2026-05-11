import { getDbPool } from '@/lib/db/pool'

export type AllocationKind = 'lesson_slot'

export type PaymentAllocation = {
  paymentOrderId: string
  kind: AllocationKind
  targetId: string
  amountKopecks: number
  createdAt: string
}

const ALLOWED_KINDS = new Set<AllocationKind>(['lesson_slot'])

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
// Refund Phase 7. A reversed allocation drops from the result so the
// cabinet returns the slot to the "оплатить" bucket. Anti-join is
// against the composite allocation key (payment_order_id, kind,
// target_id) — migration 0022 uses that composite as the allocation
// primary key; there is no surrogate uuid.
//
// Note: this function returns ONLY currently-paid slots. After Stage C
// of refund Phase 7, the cabinet uses `listSlotPaymentState` instead
// to distinguish "paid" / "refunded" / "never paid" so a refunded slot
// can render a neutral "возврат оформлен" pill rather than the yellow
// "оплатить" CTA (which would suggest the learner needs to pay again).
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
       left join payment_allocation_reversals r
              on r.payment_order_id = a.payment_order_id
             and r.kind = a.kind
             and r.target_id = a.target_id
      where a.kind = 'lesson_slot'
        and o.status = 'paid'
        and r.id is null
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
export type SlotPaymentState = 'paid' | 'refunded'

export async function listSlotPaymentState(
  slotIds: string[],
): Promise<
  Map<string, { state: SlotPaymentState; orderInvoiceId: string }>
> {
  const out = new Map<
    string,
    { state: SlotPaymentState; orderInvoiceId: string }
  >()
  if (slotIds.length === 0) return out
  const pool = getDbPool()
  const result = await pool.query(
    `select a.target_id,
            a.payment_order_id,
            r.id as reversal_id
       from payment_allocations a
       join payment_orders o on o.invoice_id = a.payment_order_id
       left join payment_allocation_reversals r
              on r.payment_order_id = a.payment_order_id
             and r.kind = a.kind
             and r.target_id = a.target_id
      where a.kind = 'lesson_slot'
        and o.status = 'paid'
        and a.target_id = any($1)`,
    [slotIds],
  )
  for (const row of result.rows) {
    out.set(String(row.target_id), {
      state: row.reversal_id ? 'refunded' : 'paid',
      orderInvoiceId: String(row.payment_order_id),
    })
  }
  return out
}
