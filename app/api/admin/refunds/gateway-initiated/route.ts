import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { readJsonObjectOr400 } from '@/lib/api/json-body'
import { recordPaymentAuditEvent } from '@/lib/audit/payment-events'
import { requireAdminRole } from '@/lib/auth/guards'
import {
  createPendingRefundAttempt,
  findRefundAttemptByIdempotency,
  markAttemptDeclined,
  markAttemptError,
  markAttemptGatewaySucceededDbFailed,
  markAttemptSucceeded,
} from '@/lib/billing/refund-attempts'
import { createAllocationReversal } from '@/lib/billing/reversals'
import { getDbPool } from '@/lib/db/pool'
import { refundTransaction } from '@/lib/payments/cloudpayments-api'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
} from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Refund Phase 7 follow-up #3 — gateway-side automation (Wave 60).
//
// Flips the refund initiation model from "operator pushes money in
// the CloudPayments dashboard, then manually records the reversal"
// to "operator hits this endpoint, the server calls CloudPayments'
// `payments/refund` API on their behalf, books the reversal on
// Success=true". Settlement on the bank side is still async via CP's
// `Refund` webhook; that path is reserved for a follow-up wave.
//
// Behind feature flag `BILLING_REFUND_GATEWAY_ENABLED`. Default
// false. Prod can't accidentally fire the API call until the flag
// is flipped.
//
// Two-phase durable flow (Codex Wave 60 HIGH #2 — partial-success
// recovery):
//
//   Phase 1 (tx 1):
//     - lock payment_allocations FOR UPDATE
//     - validate sum bounds + look up provider_transaction_id
//     - INSERT a `payment_refund_attempts` row with status='pending'
//     - COMMIT (releases the lock; attempt is durable)
//
//   Phase 2 (no tx):
//     - call CP `payments/refund` API
//
//   Phase 3 (tx 2):
//     - On CP success: re-lock the alloc, re-check sum bounds (a
//       concurrent refund may have raced in), INSERT the reversal,
//       UPDATE the attempt → 'succeeded' with gateway_refund_transaction_id
//       and reversal_id. COMMIT.
//     - On CP decline: UPDATE the attempt → 'declined' with message
//       and reason. COMMIT.
//     - On CP error / network failure: UPDATE the attempt → 'error'.
//       COMMIT.
//     - If Phase 3 tx itself fails AFTER CP returned success:
//       best-effort UPDATE the attempt → 'gateway_succeeded_db_failed'
//       on a fresh connection so the reconcile job can pick it up.
//       The audit log carries the same breadcrumb either way.
//
// Idempotency (Codex Wave 60 MEDIUM #4 — double-click). Optional
// `Idempotency-Key` header. When provided, a UNIQUE index on
// (operator_account_id, idempotency_key) catches replays: the
// existing attempt row is returned and the CP call does NOT fire a
// second time. Operators that don't send the header get the old
// "two clicks = two refunds" behaviour, mitigated by the manual
// dedup window in their UI.
//
// Scope: kind='lesson_slot' only for now. kind='package' refunds
// have extra restore-side-effects (Wave 53's
// restoreAllConsumptionsForPurchase); the manual endpoint stays
// the only path for those.

type GatewayRefundRequestBody = {
  paymentOrderId?: string
  kind?: string
  targetId?: string
  refundedKopecks?: number
  reason?: string | null
}

export async function POST(request: Request) {
  if (process.env.BILLING_REFUND_GATEWAY_ENABLED !== 'true') {
    return NextResponse.json(
      {
        error: 'gateway_refund_disabled',
        message:
          'Gateway-initiated refund is disabled. Use the manual flow at /api/admin/refunds.',
      },
      { status: 503, headers: NO_STORE },
    )
  }

  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate

  const rl = await enforceRateLimit(
    request,
    'admin:refunds:gateway:ip',
    10,
    60_000,
  )
  if (rl) return rl

  const guard = await requireAdminRole(request)
  if (!guard.ok) return guard.response

  const parsed = await readJsonObjectOr400(request)
  if (!parsed.ok) return parsed.response
  const body = parsed.body as GatewayRefundRequestBody

  const paymentOrderId =
    typeof body.paymentOrderId === 'string' ? body.paymentOrderId : ''
  const kind = typeof body.kind === 'string' ? body.kind : ''
  const targetId = typeof body.targetId === 'string' ? body.targetId : ''
  const refundedKopecks =
    typeof body.refundedKopecks === 'number' &&
    Number.isInteger(body.refundedKopecks) &&
    body.refundedKopecks > 0
      ? body.refundedKopecks
      : null
  const reason =
    typeof body.reason === 'string' && body.reason.trim().length > 0
      ? body.reason.trim().slice(0, 500)
      : null
  // Idempotency-Key header is optional. Trimmed + bounded so a
  // misbehaving client can't blow up the unique index.
  const rawIdempotencyKey = request.headers.get('Idempotency-Key')
  const idempotencyKey =
    rawIdempotencyKey && rawIdempotencyKey.trim().length > 0
      ? rawIdempotencyKey.trim().slice(0, 200)
      : null

  if (!paymentOrderId || !kind || !targetId || refundedKopecks === null) {
    return NextResponse.json(
      {
        error: 'invalid_body',
        message:
          'paymentOrderId, kind, targetId, refundedKopecks (positive int) are required',
      },
      { status: 400, headers: NO_STORE },
    )
  }
  if (kind !== 'lesson_slot') {
    return NextResponse.json(
      {
        error: 'unsupported_kind',
        message:
          "Gateway-initiated refund supports only kind='lesson_slot'. Use the manual endpoint for kind='package'.",
      },
      { status: 400, headers: NO_STORE },
    )
  }

  const pool = getDbPool()

  // --- Phase 0: idempotency replay (short-circuits BEFORE the alloc
  // lock so a successful first attempt that exhausted the allocation
  // doesn't make the replay fail with refund_exceeds_allocation). ---
  if (idempotencyKey) {
    const cached = await findRefundAttemptByIdempotency(
      guard.account.id,
      idempotencyKey,
    )
    if (cached) {
      const status =
        cached.status === 'succeeded' ? 201 :
        cached.status === 'declined' ? 502 :
        cached.status === 'error' ? 503 :
        cached.status === 'gateway_succeeded_db_failed' ? 202 :
        200
      return NextResponse.json(
        {
          replay: true,
          attempt: {
            id: cached.id,
            status: cached.status,
            gatewayRefundTransactionId: cached.gatewayRefundTransactionId,
            reversalId: cached.reversalId,
          },
        },
        { status, headers: NO_STORE },
      )
    }
  }

  // --- Phase 1: lock + validate + insert pending attempt ---
  let attemptId: string
  let transactionId: string
  let customerEmail: string | null
  {
    const client = await pool.connect()
    try {
      await client.query('begin')

      const allocRow = await client.query(
        `select amount_kopecks
           from payment_allocations
          where payment_order_id = $1 and kind = $2 and target_id = $3
          for update`,
        [paymentOrderId, kind, targetId],
      )
      if (allocRow.rows.length === 0) {
        await client.query('rollback')
        return NextResponse.json(
          {
            error: 'allocation_not_found',
            message: 'No payment_allocations row for the supplied composite key.',
          },
          { status: 404, headers: NO_STORE },
        )
      }
      const allocAmount = Number(allocRow.rows[0].amount_kopecks)
      const priorRefundedRes = await client.query(
        `select coalesce(sum(refunded_kopecks), 0)::bigint as sum
           from payment_allocation_reversals
          where payment_order_id = $1 and kind = $2 and target_id = $3`,
        [paymentOrderId, kind, targetId],
      )
      const priorRefunded = Number(priorRefundedRes.rows[0]?.sum ?? 0)
      if (priorRefunded + refundedKopecks > allocAmount) {
        await client.query('rollback')
        return NextResponse.json(
          {
            error: 'refund_exceeds_allocation',
            message: `Sum of refunds would exceed allocation: prior=${priorRefunded}, this=${refundedKopecks}, allocation=${allocAmount}.`,
          },
          { status: 400, headers: NO_STORE },
        )
      }

      const orderRow = await client.query(
        `select provider_transaction_id, customer_email
           from payment_orders
          where invoice_id = $1`,
        [paymentOrderId],
      )
      if (orderRow.rows.length === 0) {
        await client.query('rollback')
        return NextResponse.json(
          {
            error: 'order_not_found',
            message: 'payment_orders row not found for the supplied invoice_id.',
          },
          { status: 404, headers: NO_STORE },
        )
      }
      const txIdRaw = orderRow.rows[0].provider_transaction_id
      if (!txIdRaw) {
        await client.query('rollback')
        return NextResponse.json(
          {
            error: 'no_transaction_id',
            message:
              'Order has no provider_transaction_id — gateway refund unavailable. Use the manual flow.',
          },
          { status: 422, headers: NO_STORE },
        )
      }
      transactionId = String(txIdRaw)
      customerEmail = orderRow.rows[0].customer_email
        ? String(orderRow.rows[0].customer_email)
        : null

      // Phase 0 has already short-circuited the idempotent replay
      // case before we got here, so this insert will succeed
      // unconditionally. The createPendingRefundAttempt helper still
      // has a defence-in-depth replay check that would catch a race
      // between two concurrent first-call requests with the same
      // idempotency key — but Phase 0 covers the common case.
      const { attempt } = await createPendingRefundAttempt(client, {
        paymentOrderId,
        kind,
        targetId,
        refundedKopecks,
        operatorAccountId: guard.account.id,
        idempotencyKey,
        originalTransactionId: transactionId,
        reason,
      })
      attemptId = attempt.id

      await client.query('commit')
    } catch (err) {
      await client.query('rollback').catch(() => {})
      console.warn('[admin.refunds.gateway.phase1] unexpected error', {
        error: err instanceof Error ? err.message : String(err),
      })
      return NextResponse.json(
        { error: 'internal_error' },
        { status: 500, headers: NO_STORE },
      )
    } finally {
      client.release()
    }
  }

  // --- Phase 2: call CP (no tx held) ---
  const cpResult = await refundTransaction({
    transactionId,
    amount: refundedKopecks / 100,
    jsonData: JSON.stringify({
      invoiceId: paymentOrderId,
      kind,
      targetId,
      attemptId,
      reason,
    }),
  })

  // --- Phase 3: finalize the attempt ---
  if (cpResult.kind === 'error') {
    const client = await pool.connect()
    try {
      await client.query('begin')
      await markAttemptError(client, attemptId, cpResult.message)
      await client.query('commit')
    } catch {
      // Best-effort finalize; if even this fails the reconcile job
      // walks 'pending' rows next.
    } finally {
      client.release()
    }
    try {
      await recordPaymentAuditEvent({
        eventType: 'payment.refund.initiated.gateway',
        invoiceId: paymentOrderId,
        customerEmail,
        amountKopecks: refundedKopecks,
        toStatus: null,
        actor: 'admin',
        payload: {
          allocationKey: { paymentOrderId, kind, targetId },
          attemptId,
          transactionId,
          outcome: 'error',
          cpMessage: cpResult.message,
        },
      })
    } catch (auditErr) {
      console.warn('[admin.refunds.gateway.audit] failed', {
        attemptId,
        error: auditErr instanceof Error ? auditErr.message : String(auditErr),
      })
    }
    return NextResponse.json(
      {
        error: 'gateway_error',
        message: cpResult.message,
        attemptId,
      },
      { status: 503, headers: NO_STORE },
    )
  }

  if (cpResult.kind === 'declined') {
    const client = await pool.connect()
    try {
      await client.query('begin')
      await markAttemptDeclined(
        client,
        attemptId,
        cpResult.message,
        cpResult.reasonCode ?? null,
      )
      await client.query('commit')
    } catch {
      /* best-effort */
    } finally {
      client.release()
    }
    try {
      await recordPaymentAuditEvent({
        eventType: 'payment.refund.initiated.gateway',
        invoiceId: paymentOrderId,
        customerEmail,
        amountKopecks: refundedKopecks,
        toStatus: null,
        actor: 'admin',
        payload: {
          allocationKey: { paymentOrderId, kind, targetId },
          attemptId,
          transactionId,
          outcome: 'declined',
          cpMessage: cpResult.message,
          cpReasonCode: cpResult.reasonCode ?? null,
        },
      })
    } catch (auditErr) {
      console.warn('[admin.refunds.gateway.audit] failed', {
        attemptId,
        error: auditErr instanceof Error ? auditErr.message : String(auditErr),
      })
    }
    return NextResponse.json(
      {
        error: 'gateway_declined',
        message: cpResult.message,
        cpReasonCode: cpResult.reasonCode ?? null,
        attemptId,
      },
      { status: 502, headers: NO_STORE },
    )
  }

  // CP success path. Re-lock the alloc, re-validate (concurrent
  // refund may have raced), insert reversal, link to attempt.
  const gatewayTxId = cpResult.transactionId
  const client = await pool.connect()
  try {
    await client.query('begin')
    const allocRow = await client.query(
      `select amount_kopecks
         from payment_allocations
        where payment_order_id = $1 and kind = $2 and target_id = $3
        for update`,
      [paymentOrderId, kind, targetId],
    )
    if (allocRow.rows.length === 0) {
      throw new Error('alloc disappeared between Phase 1 and Phase 3')
    }
    const allocAmount = Number(allocRow.rows[0].amount_kopecks)
    const priorRefundedRes = await client.query(
      `select coalesce(sum(refunded_kopecks), 0)::bigint as sum
         from payment_allocation_reversals
        where payment_order_id = $1 and kind = $2 and target_id = $3`,
      [paymentOrderId, kind, targetId],
    )
    const priorRefunded = Number(priorRefundedRes.rows[0]?.sum ?? 0)
    if (priorRefunded + refundedKopecks > allocAmount) {
      // Race: CP succeeded but another refund landed first. Cannot
      // safely insert another reversal. Mark attempt as
      // gateway_succeeded_db_failed; operator reconciles via CP
      // dashboard. Bank refund proceeds.
      throw new Error('refund exceeds allocation after CP success')
    }
    const reversal = await createAllocationReversal(client, {
      paymentOrderId,
      kind,
      targetId,
      refundedKopecks,
      refundedByAccountId: guard.account.id,
      reason,
    })
    await markAttemptSucceeded(client, attemptId, gatewayTxId, reversal.id)
    await client.query('commit')

    try {
      await recordPaymentAuditEvent({
        eventType: 'payment.refund.initiated.gateway',
        invoiceId: paymentOrderId,
        customerEmail,
        amountKopecks: refundedKopecks,
        toStatus: 'refunded',
        actor: 'admin',
        payload: {
          allocationKey: { paymentOrderId, kind, targetId },
          attemptId,
          transactionId,
          gatewayRefundTransactionId: gatewayTxId,
          reversalId: reversal.id,
          outcome: 'success',
          reason,
        },
      })
    } catch (auditErr) {
      console.warn('[admin.refunds.gateway.audit] failed', {
        reversalId: reversal.id,
        error: auditErr instanceof Error ? auditErr.message : String(auditErr),
      })
    }

    return NextResponse.json(
      {
        reversal,
        gatewayRefundTransactionId: gatewayTxId,
        attemptId,
      },
      { status: 201, headers: NO_STORE },
    )
  } catch (err) {
    await client.query('rollback').catch(() => {})
    const msg = err instanceof Error ? err.message : String(err)
    console.warn('[admin.refunds.gateway.phase3] failed after CP success', {
      attemptId,
      gatewayRefundTransactionId: gatewayTxId,
      error: msg,
    })
    // Best-effort mark attempt as gateway_succeeded_db_failed on a
    // fresh connection so reconcile picks it up. Use a try block so
    // a follow-up DB outage doesn't crash the response.
    try {
      await markAttemptGatewaySucceededDbFailed(attemptId, gatewayTxId, msg)
    } catch {
      /* nothing more we can do; reconcile walks 'pending' too */
    }
    try {
      await recordPaymentAuditEvent({
        eventType: 'payment.refund.initiated.gateway',
        invoiceId: paymentOrderId,
        customerEmail,
        amountKopecks: refundedKopecks,
        toStatus: null,
        actor: 'admin',
        payload: {
          allocationKey: { paymentOrderId, kind, targetId },
          attemptId,
          transactionId,
          gatewayRefundTransactionId: gatewayTxId,
          outcome: 'gateway_succeeded_db_failed',
          error: msg,
        },
      })
    } catch (auditErr) {
      console.warn('[admin.refunds.gateway.audit] failed', {
        attemptId,
        error: auditErr instanceof Error ? auditErr.message : String(auditErr),
      })
    }
    // 202 — gateway accepted; our DB is mid-reconcile. Operator
    // sees the attemptId + gatewayRefundTransactionId so they can
    // verify on the CP side.
    return NextResponse.json(
      {
        error: 'gateway_succeeded_db_failed',
        message:
          'CloudPayments accepted the refund but our DB write failed. The attempt is recorded for reconciliation; verify on the CP dashboard.',
        attemptId,
        gatewayRefundTransactionId: gatewayTxId,
      },
      { status: 202, headers: NO_STORE },
    )
  } finally {
    client.release()
  }
}
