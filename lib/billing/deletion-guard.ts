// Wave 59 — deletion-guard helper for in-flight package grants.
//
// Closes the contract gap documented in `docs/plans/prepay-postpay-billing.md`
// v9 §"Account-lifecycle policy during in-flight package grant" (Codex
// rounds 6, 7, 8). The design pinned `accountHasInFlightPackageGrant`
// as the canonical predicate to call at TWO points: the schedule step
// (`requestAccountDeletion`) AND the execute step (cron-side anonymizer
// in `scripts/db-retention-cleanup.mjs`). The Wave 13 dead-code sweep
// deleted an earlier (never-wired) version of the helper; the 30-day
// grace was the only mitigation. This restores the design contract.
//
// The predicate has TWO branches:
//
//   Branch A — pending-and-not-yet-paid:
//     EXISTS (
//       SELECT 1 FROM payment_orders
//        WHERE metadata->>'accountId' = $1
//          AND metadata->>'packageSlug' IS NOT NULL
//          AND status IN ('pending', '3ds_required')
//          AND created_at > now() - interval '15 minutes'
//     )
//
//   Branch B — paid-but-grant-not-materialized:
//     EXISTS (
//       SELECT 1 FROM payment_orders po
//        WHERE po.metadata->>'accountId' = $1
//          AND po.metadata->>'packageSlug' IS NOT NULL
//          AND po.status = 'paid'
//          AND NOT EXISTS (
//            SELECT 1 FROM package_purchases pp
//             WHERE pp.payment_order_id = po.invoice_id
//          )
//     )
//
// Branch A is bounded to 15 min because the 60-min janitor
// (`cancel-stale-orders.mjs`) auto-cancels stuck pending orders;
// without the bound, an abandoned 3DS flow could lock deletion
// forever. Branch B has NO time bound — paid-not-granted is money
// already captured and deserves an indefinite block until operator
// reconciliation, e.g. via `/admin/payments`.

import type { Pool, PoolClient } from 'pg'

import { getDbPool } from '@/lib/db/pool'

export type InFlightGrantReason = 'pending_within_15min' | 'paid_not_granted'

export type AccountInFlightGrantStatus = {
  inFlight: boolean
  // Populated only when inFlight=true. Surfaces which branch matched
  // so the route can pick the right user-facing message and the
  // anonymizer can tag its skip event.
  reason: InFlightGrantReason | null
  // Lowest invoice_id for the matching order — useful as a diagnostic
  // breadcrumb in audit / cron logs. Null when inFlight=false.
  sampleInvoiceId: string | null
}

// Accepts either a pool or an existing tx client so callers can run
// the check inside their own transaction (e.g. the cron anonymizer
// does the re-check + the UPDATE in the same row-tx).
export async function checkAccountInFlightPackageGrant(
  conn: Pool | PoolClient,
  accountId: string,
): Promise<AccountInFlightGrantStatus> {
  const result = await conn.query(
    `select
       (
         select po.invoice_id
           from payment_orders po
          where po.metadata->>'accountId' = $1
            and po.metadata->>'packageSlug' is not null
            and po.status in ('pending', '3ds_required')
            and po.created_at > now() - interval '15 minutes'
          order by po.created_at asc
          limit 1
       ) as branch_a_invoice,
       (
         select po.invoice_id
           from payment_orders po
          where po.metadata->>'accountId' = $1
            and po.metadata->>'packageSlug' is not null
            and po.status = 'paid'
            and not exists (
              select 1 from package_purchases pp
               where pp.payment_order_id = po.invoice_id
            )
          order by po.created_at asc
          limit 1
       ) as branch_b_invoice`,
    [accountId],
  )
  const row = result.rows[0] ?? {}
  const branchAInvoice = row.branch_a_invoice ? String(row.branch_a_invoice) : null
  const branchBInvoice = row.branch_b_invoice ? String(row.branch_b_invoice) : null
  // Branch B takes precedence — paid-not-granted is the more serious
  // case (money already captured) and the message-side should escalate
  // toward operator reconciliation, not a "try again in 15 min" hint.
  if (branchBInvoice !== null) {
    return {
      inFlight: true,
      reason: 'paid_not_granted',
      sampleInvoiceId: branchBInvoice,
    }
  }
  if (branchAInvoice !== null) {
    return {
      inFlight: true,
      reason: 'pending_within_15min',
      sampleInvoiceId: branchAInvoice,
    }
  }
  return { inFlight: false, reason: null, sampleInvoiceId: null }
}

// Convenience wrapper for the route path — accepts no pool/client.
export async function accountHasInFlightPackageGrant(
  accountId: string,
): Promise<AccountInFlightGrantStatus> {
  return checkAccountInFlightPackageGrant(getDbPool(), accountId)
}
