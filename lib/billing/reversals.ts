// Refund Phase 7, Stage A. Data-layer helpers for
// payment_allocation_reversals (migration 0036).
//
// Stage A scope: pure data helpers — read existing reversals, create a
// new one inside a transaction. Stage B will add the admin endpoint
// that calls createAllocationReversal in the same tx as
// restorePackageConsumption (for kind='package' allocations).
//
// payment_allocations identifies a row by the composite
// (payment_order_id, kind, target_id) — see migration 0022. Reversals
// reference that composite, not a surrogate UUID.

import type { PoolClient } from 'pg'

import { getDbPool } from '@/lib/db/pool'

export type AllocationKey = {
  paymentOrderId: string
  kind: string
  targetId: string
}

export type AllocationReversal = {
  id: string
  paymentOrderId: string
  kind: string
  targetId: string
  refundedAt: string
  refundedKopecks: number
  refundedByAccountId: string
  reason: string | null
  createdAt: string
}

const REVERSAL_COLS =
  'id, payment_order_id, kind, target_id, refunded_at, refunded_kopecks, ' +
  'refunded_by_account_id, reason, created_at'

function rowToReversal(row: Record<string, unknown>): AllocationReversal {
  return {
    id: String(row.id),
    paymentOrderId: String(row.payment_order_id),
    kind: String(row.kind),
    targetId: String(row.target_id),
    refundedAt: new Date(String(row.refunded_at)).toISOString(),
    refundedKopecks: Number(row.refunded_kopecks),
    refundedByAccountId: String(row.refunded_by_account_id),
    reason: row.reason ? String(row.reason) : null,
    createdAt: new Date(String(row.created_at)).toISOString(),
  }
}

// Create a reversal. Caller passes the pool client so the operation
// can sit inside a larger transaction (e.g. with
// restorePackageConsumption for package-kind allocations).
//
// Wave 54 — partial reversals supported. Multiple rows per allocation
// are now valid; the route caller is responsible for asserting
// SUM(refunded_kopecks) does not exceed the allocation amount.
export async function createAllocationReversal(
  client: PoolClient,
  input: AllocationKey & {
    refundedKopecks: number
    refundedByAccountId: string
    reason?: string | null
    refundedAt?: Date
  },
): Promise<AllocationReversal> {
  const result = await client.query(
    `insert into payment_allocation_reversals
       (payment_order_id, kind, target_id,
        refunded_kopecks, refunded_by_account_id, reason, refunded_at)
     values ($1, $2, $3, $4, $5, $6, coalesce($7::timestamptz, now()))
     returning ${REVERSAL_COLS}`,
    [
      input.paymentOrderId,
      input.kind,
      input.targetId,
      input.refundedKopecks,
      input.refundedByAccountId,
      input.reason ?? null,
      input.refundedAt ? input.refundedAt.toISOString() : null,
    ],
  )
  return rowToReversal(result.rows[0])
}

// Wave 54 — partial reversals. An allocation can carry 0..N reversal
// rows. Sum them up so callers can decide whether the allocation is
// fully refunded (SUM >= amount) or still partly paid.
export async function listReversalsForAllocation(
  key: AllocationKey,
): Promise<AllocationReversal[]> {
  const pool = getDbPool()
  const result = await pool.query(
    `select ${REVERSAL_COLS}
       from payment_allocation_reversals
      where payment_order_id = $1
        and kind = $2
        and target_id = $3
      order by created_at asc`,
    [key.paymentOrderId, key.kind, key.targetId],
  )
  return result.rows.map((r) => rowToReversal(r as Record<string, unknown>))
}

// Sum already-recorded reversals for an allocation, inside the caller
// tx so a concurrent refund cannot slip in between the SUM and the
// follow-up INSERT. Caller chooses whether to take a row lock on the
// allocation row before calling.
export async function sumReversalsForAllocation(
  client: PoolClient,
  key: AllocationKey,
): Promise<number> {
  const result = await client.query(
    `select coalesce(sum(refunded_kopecks), 0)::bigint as sum
       from payment_allocation_reversals
      where payment_order_id = $1
        and kind = $2
        and target_id = $3`,
    [key.paymentOrderId, key.kind, key.targetId],
  )
  return Number(result.rows[0]?.sum ?? 0)
}

export async function listReversalsForOrder(
  paymentOrderId: string,
): Promise<AllocationReversal[]> {
  const pool = getDbPool()
  const result = await pool.query(
    `select ${REVERSAL_COLS}
       from payment_allocation_reversals
      where payment_order_id = $1
      order by created_at asc`,
    [paymentOrderId],
  )
  return result.rows.map((r) => rowToReversal(r as Record<string, unknown>))
}
