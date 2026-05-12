// Wave 61 — refund reconcile worker. Walks non-terminal rows in
// `payment_refund_attempts` and resolves them.
//
// Closes the Codex Wave 60 round 2 RESIDUAL HIGH #2: Wave 60 ships
// the durable breadcrumb infrastructure (attempt row with status =
// 'gateway_succeeded_db_failed' / 'pending'), but without a
// consumer for those rows the bank-side refund can still drift from
// our DB. This worker is that consumer.
//
// Two reconcile branches:
//
//   Branch A — status='gateway_succeeded_db_failed'.
//     CP accepted the refund, the bank-side money movement is in
//     flight, but our follow-up reversal insert errored at the
//     route. The attempt row carries everything needed to re-attempt:
//     payment_order_id, kind, target_id, refunded_kopecks,
//     operator_account_id, gateway_refund_transaction_id. Re-lock
//     the allocation, re-validate sum bounds (a manual refund may
//     have raced in — operator reconciles manually in that case),
//     insert the reversal, mark attempt='succeeded'. Emit
//     `payment.refund.gateway.webhook` audit event.
//
//   Branch B — status='pending' older than PENDING_TIMEOUT.
//     The CP call hung or the route crashed before transitioning
//     the attempt. We don't have the gateway refund txn id (it
//     would have been populated on success), so we can't ask CP
//     to confirm the bank state. Mark the attempt='error' with a
//     diagnostic message; operator manually checks the CP dashboard
//     and either reissues the refund or books a manual reversal.
//
// Idempotent: re-running on a terminal row is a no-op. The query
// uses the `payment_refund_attempts_reconcile_idx` partial index
// (status in ('pending','gateway_succeeded_db_failed','error')) so
// the worker's read load stays cheap as the table grows.

import type { PoolClient } from 'pg'

import { recordPaymentAuditEvent } from '@/lib/audit/payment-events'
import { getDbPool } from '@/lib/db/pool'
import { createAllocationReversal } from '@/lib/billing/reversals'

// Default thresholds — tuned for a 5-minute cron cadence. A pending
// row younger than this is still in-flight from the route's
// perspective; older than this and either the route crashed or CP
// has been silent for too long.
export const DEFAULT_PENDING_TIMEOUT_MINUTES = 30
export const DEFAULT_BATCH_SIZE = 100

export type ReconcileBranchOutcome =
  | 'reversed' // gateway_succeeded_db_failed → succeeded
  | 'pending_timed_out' // pending older than threshold → error
  | 'reconcile_collision' // re-validate found bounds-violation; left as gateway_succeeded_db_failed
  | 'audit_only' // best-effort audit; no DB transition needed

export type ReconcileResult = {
  attemptId: string
  outcome: ReconcileBranchOutcome
  message: string
}

export type ReconcileSummary = {
  reversed: number
  pendingTimedOut: number
  reconcileCollisions: number
  errors: number
  totalCandidates: number
}

// Branch A worker. Caller passes a single attempt row id; the
// function opens its own tx and either books the reversal (success
// path) or leaves the attempt in `gateway_succeeded_db_failed` for
// the operator (collision path).
async function reconcileGatewaySucceededDbFailed(
  attemptId: string,
): Promise<ReconcileResult> {
  const pool = getDbPool()
  const client = await pool.connect()
  try {
    await client.query('begin')
    // Lock the attempt row first so two concurrent reconcile workers
    // can't double-book the reversal.
    const attemptRes = await client.query(
      `select id, payment_order_id, kind, target_id, refunded_kopecks,
              operator_account_id, gateway_refund_transaction_id, reason
         from payment_refund_attempts
        where id = $1
          and status = 'gateway_succeeded_db_failed'
        for update`,
      [attemptId],
    )
    if (attemptRes.rows.length === 0) {
      await client.query('rollback')
      return {
        attemptId,
        outcome: 'audit_only',
        message:
          'attempt missing or status changed between lookup and reconcile',
      }
    }
    const a = attemptRes.rows[0]
    const paymentOrderId = String(a.payment_order_id)
    const kind = String(a.kind)
    const targetId = String(a.target_id)
    const refundedKopecks = Number(a.refunded_kopecks)
    const operatorAccountId = String(a.operator_account_id)
    const gatewayTxId = String(a.gateway_refund_transaction_id)
    const reason = a.reason ? String(a.reason) : null

    // Re-lock + re-validate the allocation.
    const allocRes = await client.query(
      `select amount_kopecks
         from payment_allocations
        where payment_order_id = $1 and kind = $2 and target_id = $3
        for update`,
      [paymentOrderId, kind, targetId],
    )
    if (allocRes.rows.length === 0) {
      // Alloc disappeared. Mark attempt as error so operator notices.
      await client.query(
        `update payment_refund_attempts
            set status = 'error',
                gateway_message = 'reconcile: allocation row missing',
                updated_at = now()
          where id = $1`,
        [attemptId],
      )
      await client.query('commit')
      return {
        attemptId,
        outcome: 'audit_only',
        message: 'allocation row missing — marked error',
      }
    }
    const allocAmount = Number(allocRes.rows[0].amount_kopecks)
    const priorRes = await client.query(
      `select coalesce(sum(refunded_kopecks), 0)::bigint as sum
         from payment_allocation_reversals
        where payment_order_id = $1 and kind = $2 and target_id = $3`,
      [paymentOrderId, kind, targetId],
    )
    const priorRefunded = Number(priorRes.rows[0]?.sum ?? 0)
    if (priorRefunded + refundedKopecks > allocAmount) {
      // A manual refund landed between the gateway-call and the
      // reconcile. We can't safely insert another reversal. Leave
      // the attempt in gateway_succeeded_db_failed but stamp a
      // diagnostic message so the operator knows reconcile saw it
      // and bailed.
      await client.query(
        `update payment_refund_attempts
            set gateway_message =
                  'reconcile: prior=' || $2::text ||
                  ' + this=' || $3::text ||
                  ' > allocation=' || $4::text ||
                  '; manual reconciliation required',
                updated_at = now()
          where id = $1`,
        [attemptId, priorRefunded, refundedKopecks, allocAmount],
      )
      await client.query('commit')
      return {
        attemptId,
        outcome: 'reconcile_collision',
        message: `prior=${priorRefunded} + this=${refundedKopecks} > allocation=${allocAmount}`,
      }
    }
    // Safe to book the reversal.
    const reversal = await createAllocationReversal(client, {
      paymentOrderId,
      kind,
      targetId,
      refundedKopecks,
      refundedByAccountId: operatorAccountId,
      reason,
    })
    await client.query(
      `update payment_refund_attempts
          set status = 'succeeded',
              reversal_id = $2,
              gateway_message = null,
              updated_at = now()
        where id = $1`,
      [attemptId, reversal.id],
    )
    await client.query('commit')

    // Best-effort audit on a different pool connection. Failure here
    // doesn't roll back the reconcile.
    try {
      await recordPaymentAuditEvent({
        eventType: 'payment.refund.gateway.webhook',
        invoiceId: paymentOrderId,
        customerEmail: null,
        amountKopecks: refundedKopecks,
        toStatus: 'refunded',
        actor: 'admin',
        payload: {
          allocationKey: { paymentOrderId, kind, targetId },
          attemptId,
          gatewayRefundTransactionId: gatewayTxId,
          reversalId: reversal.id,
          source: 'reconcile.gateway_succeeded_db_failed',
        },
      })
    } catch (auditErr) {
      console.warn('[refund-reconcile.audit] failed', {
        attemptId,
        error: auditErr instanceof Error ? auditErr.message : String(auditErr),
      })
    }
    return {
      attemptId,
      outcome: 'reversed',
      message: `booked reversal ${reversal.id}`,
    }
  } catch (err) {
    await client.query('rollback').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

// Branch B worker. Pending attempts older than the threshold get
// marked as 'error' with a diagnostic message so the operator
// notices and reconciles manually via the CP dashboard.
async function reconcilePendingTimeout(
  attemptId: string,
): Promise<ReconcileResult> {
  const pool = getDbPool()
  const client = await pool.connect()
  try {
    await client.query('begin')
    const res = await client.query(
      `update payment_refund_attempts
          set status = 'error',
              gateway_message =
                'reconcile: pending timed out after ' ||
                extract(epoch from (now() - created_at))::int || 's; ' ||
                'manual reconciliation required via CP dashboard',
              updated_at = now()
        where id = $1
          and status = 'pending'`,
      [attemptId],
    )
    await client.query('commit')
    if (res.rowCount === 0) {
      return {
        attemptId,
        outcome: 'audit_only',
        message: 'attempt status changed between lookup and update',
      }
    }
    return {
      attemptId,
      outcome: 'pending_timed_out',
      message: 'marked error after pending timeout',
    }
  } catch (err) {
    await client.query('rollback').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

// Top-level entry point. Walks the non-terminal partial index oldest
// first, dispatches each row to the right branch, returns a summary.
//
// The query uses the reconcile-target index
// (`payment_refund_attempts_reconcile_idx`) so the worker's read
// cost stays bounded even if the table grows.
export async function runRefundReconcile(opts?: {
  pendingTimeoutMinutes?: number
  batchSize?: number
  // For tests — inject a fixed "now" if needed.
  now?: Date
}): Promise<{ summary: ReconcileSummary; results: ReconcileResult[] }> {
  const pendingTimeoutMinutes =
    opts?.pendingTimeoutMinutes ?? DEFAULT_PENDING_TIMEOUT_MINUTES
  const batchSize = opts?.batchSize ?? DEFAULT_BATCH_SIZE
  const pool = getDbPool()

  // Two queries: candidates by status. Easier than a CASE in a single
  // query because the action is different per branch.
  const stuckRes = await pool.query(
    `select id from payment_refund_attempts
      where status = 'gateway_succeeded_db_failed'
      order by created_at asc
      limit $1`,
    [batchSize],
  )
  const pendingRes = await pool.query(
    `select id from payment_refund_attempts
      where status = 'pending'
        and created_at < now() - make_interval(mins => $1::int)
      order by created_at asc
      limit $2`,
    [pendingTimeoutMinutes, batchSize],
  )

  const results: ReconcileResult[] = []
  const summary: ReconcileSummary = {
    reversed: 0,
    pendingTimedOut: 0,
    reconcileCollisions: 0,
    errors: 0,
    totalCandidates: stuckRes.rows.length + pendingRes.rows.length,
  }

  for (const row of stuckRes.rows) {
    try {
      const r = await reconcileGatewaySucceededDbFailed(String(row.id))
      results.push(r)
      if (r.outcome === 'reversed') summary.reversed += 1
      else if (r.outcome === 'reconcile_collision')
        summary.reconcileCollisions += 1
    } catch (err) {
      summary.errors += 1
      results.push({
        attemptId: String(row.id),
        outcome: 'audit_only',
        message:
          'reconcile error: ' +
          (err instanceof Error ? err.message : String(err)),
      })
    }
  }
  for (const row of pendingRes.rows) {
    try {
      const r = await reconcilePendingTimeout(String(row.id))
      results.push(r)
      if (r.outcome === 'pending_timed_out') summary.pendingTimedOut += 1
    } catch (err) {
      summary.errors += 1
      results.push({
        attemptId: String(row.id),
        outcome: 'audit_only',
        message:
          'reconcile error: ' +
          (err instanceof Error ? err.message : String(err)),
      })
    }
  }

  return { summary, results }
}

// Exported for tests that want to drive a single branch directly
// (e.g. seed a gateway_succeeded_db_failed row and assert the
// resulting reversal). The dispatcher above is the production entry
// point.
export const _internal = {
  reconcileGatewaySucceededDbFailed,
  reconcilePendingTimeout,
} as const

// Tiny type-only re-export silences `tsc --noEmit` if `PoolClient`
// becomes unused after future refactors.
export type _PoolClient = PoolClient
