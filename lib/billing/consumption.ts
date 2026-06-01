// Billing wave PR 1 — package consumption ledger.
//
// Design doc: docs/plans/prepay-postpay-billing.md (v9, Codex SIGN-OFF).
// Migration: 0033_billing_packages_and_postpaid.sql.
//
// Shape: append-only ledger (`package_consumptions(slot_id PK, ...)`).
// `slot_id PK` is the security boundary against double-charge — even
// if every other guard fails, a second consumption attempt for the
// same slot returns 23505. Restore is `UPDATE ... SET restored_at`
// on the same row, never delete; idempotent under concurrent cancels.
//
// All functions accept an optional `client` so callers can compose
// them inside an existing transaction (the booking flow wraps slot
// reservation + consumption attempt in one tx; the cancel flow
// wraps slot status update + restore in one tx).

import type { PoolClient } from 'pg'

import { getDbPool } from '@/lib/db/pool'

export type ConsumePackageActor = 'learner' | 'admin' | 'teacher'

export type ConsumePackageResult =
  | { ok: true; packagePurchaseId: string }
  | { ok: false; reason: 'no_eligible_package' | 'already_consumed' }

// Try to consume one unit from the earliest-expiring matching package
// for the given account. Race-safe via:
//   1. SELECT ... FOR UPDATE on the candidate row inside the txn.
//   2. INSERT ... ON CONFLICT (slot_id) DO NOTHING — second attempt
//      for the same slot returns 0 rows.
//   3. The derived count_remaining check uses a sub-select against
//      package_consumptions (with `restored_at IS NULL`) so an
//      in-flight restore on the same purchase doesn't shift the
//      count under us.
//
// Caller is expected to hold a per-account advisory lock for strict
// FIFO across concurrent bookings of the same learner.
export async function consumePackageUnit(
  client: PoolClient,
  args: {
    accountId: string
    slotId: string
    durationMinutes: number
    actor: ConsumePackageActor
    /** PKG-TEACHER-SCOPE (2026-06-01) — slot's teacher_account_id.
     * Required so a learner with packages from teachers A AND B
     * cannot consume A's package against B's slot. Without this
     * predicate the FIFO scan returned A's purchase when B's slot
     * was being booked — silent cross-teacher debit. */
    expectedTeacherId: string
  },
): Promise<ConsumePackageResult> {
  // Find the earliest-expiring package with capacity. Lock the row
  // with FOR UPDATE so a concurrent restore on the same purchase
  // (which would change count_remaining) waits.
  const eligible = await client.query(
    `select pp.id
       from package_purchases pp
      where pp.account_id = $1
        and pp.duration_minutes = $2
        and pp.teacher_id = $3
        and pp.expires_at > now()
        -- Refund Phase 7 follow-up. A voided purchase (refunded) MUST
        -- NOT be re-consumed. Migration 0038 adds the column; nullable
        -- so unrefunded purchases stay live.
        and pp.voided_at is null
        and pp.count_initial - (
              select count(*) from package_consumptions pc
               where pc.package_purchase_id = pp.id
                 and pc.restored_at is null
            ) > 0
      order by pp.expires_at asc, pp.id
      limit 1
      for update`,
    [args.accountId, args.durationMinutes, args.expectedTeacherId],
  )
  if (eligible.rows.length === 0) {
    return { ok: false, reason: 'no_eligible_package' }
  }
  const purchaseId = String(eligible.rows[0].id)

  const consumed = await client.query(
    `insert into package_consumptions
       (slot_id, package_purchase_id, consumed_by_actor)
     values ($1, $2, $3)
     on conflict (slot_id) do nothing
     returning package_purchase_id`,
    [args.slotId, purchaseId, args.actor],
  )
  if (consumed.rows.length === 0) {
    // Another consumer beat us to this slot. Should not happen given
    // the booking flow runs the slot UPDATE before this function, but
    // belt + suspenders.
    return { ok: false, reason: 'already_consumed' }
  }
  return { ok: true, packagePurchaseId: String(consumed.rows[0].package_purchase_id) }
}

// Refund Phase 7 follow-up. Bulk restore every active consumption on
// a purchase + mark the purchase voided. Called from the admin refund
// endpoint when refunding a kind='package' allocation. All in one tx
// (caller's): mass UPDATE of consumptions + UPDATE of purchase row.
// Idempotent on re-run (subsequent calls just set restored_at on
// nothing + re-stamp voided_at, which we make a no-op when already
// non-null).
export async function restoreAllConsumptionsForPurchase(
  client: PoolClient,
  args: {
    packagePurchaseId: string
    actor: ConsumePackageActor
    reason?: string | null
  },
): Promise<{ restoredCount: number; alreadyVoided: boolean }> {
  // Void the purchase row first so concurrent consumePackageUnit
  // attempts see the voided_at IS NULL filter fail. FOR UPDATE
  // briefly waits if another tx is mid-consume against this purchase.
  const voidRes = await client.query(
    `update package_purchases
        set voided_at = coalesce(voided_at, now())
      where id = $1
      returning (voided_at = now() and voided_at is not null) as just_voided`,
    [args.packagePurchaseId],
  )
  const alreadyVoided =
    voidRes.rows.length === 0
      ? false
      : !Boolean(voidRes.rows[0].just_voided)

  const restored = await client.query(
    `update package_consumptions
        set restored_at = now(),
            restored_by_actor = $2,
            restored_reason = $3
      where package_purchase_id = $1
        and restored_at is null`,
    [args.packagePurchaseId, args.actor, args.reason ?? null],
  )
  return {
    restoredCount: restored.rowCount ?? 0,
    alreadyVoided,
  }
}

// Restore a consumption (cancel path). Idempotent: stamps `restored_at`
// only on rows where it's NULL. Two concurrent restore calls
// (e.g. learner-cancel race with admin-cancel) cannot both succeed
// — the WHERE clause is the boundary.
//
// Returns the package_purchase_id of the restored row, or null if no
// active consumption existed for the slot. Null means either:
//   - the slot was never consumed from a package (postpaid path), OR
//   - the consumption was already restored.
// Either is a no-op for the caller.
export async function restorePackageConsumption(
  client: PoolClient,
  args: {
    slotId: string
    actor: ConsumePackageActor
    reason?: string | null
  },
): Promise<{ packagePurchaseId: string } | null> {
  const result = await client.query(
    `update package_consumptions
        set restored_at = now(),
            restored_by_actor = $2,
            restored_reason = $3
      where slot_id = $1
        and restored_at is null
      returning package_purchase_id`,
    [args.slotId, args.actor, args.reason ?? null],
  )
  if (result.rows.length === 0) return null
  return { packagePurchaseId: String(result.rows[0].package_purchase_id) }
}

// Read-only helper: how many units remain on a purchase. Derived
// from count_initial - count(active consumptions). Used by the
// /api/account/packages endpoint and by tests.
export async function derivePackageRemaining(
  packagePurchaseId: string,
): Promise<{
  countInitial: number
  countRemaining: number
  countConsumed: number
} | null> {
  const pool = getDbPool()
  const result = await pool.query(
    `select pp.count_initial,
            (
              select count(*) from package_consumptions pc
               where pc.package_purchase_id = pp.id
                 and pc.restored_at is null
            ) as active_consumptions
       from package_purchases pp
      where pp.id = $1`,
    [packagePurchaseId],
  )
  if (result.rows.length === 0) return null
  const countInitial = Number(result.rows[0].count_initial)
  const countConsumed = Number(result.rows[0].active_consumptions)
  return {
    countInitial,
    countConsumed,
    countRemaining: Math.max(0, countInitial - countConsumed),
  }
}

// Read the consumption row for a given slot — useful for audit /
// debugging / cabinet UI. Returns the row whether or not it's been
// restored (caller checks the restored_at field).
export async function getConsumptionForSlot(
  slotId: string,
): Promise<{
  slotId: string
  packagePurchaseId: string
  consumedAt: string
  consumedByActor: string
  restoredAt: string | null
  restoredByActor: string | null
  restoredReason: string | null
} | null> {
  const pool = getDbPool()
  const result = await pool.query(
    `select slot_id, package_purchase_id, consumed_at, consumed_by_actor,
            restored_at, restored_by_actor, restored_reason
       from package_consumptions
      where slot_id = $1`,
    [slotId],
  )
  if (result.rows.length === 0) return null
  const row = result.rows[0]
  return {
    slotId: String(row.slot_id),
    packagePurchaseId: String(row.package_purchase_id),
    consumedAt: new Date(String(row.consumed_at)).toISOString(),
    consumedByActor: String(row.consumed_by_actor),
    restoredAt: row.restored_at ? new Date(String(row.restored_at)).toISOString() : null,
    restoredByActor: row.restored_by_actor ? String(row.restored_by_actor) : null,
    restoredReason: row.restored_reason ? String(row.restored_reason) : null,
  }
}
