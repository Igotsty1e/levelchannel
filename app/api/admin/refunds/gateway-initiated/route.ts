import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { readJsonObjectOr400 } from '@/lib/api/json-body'
import { recordPaymentAuditEvent } from '@/lib/audit/payment-events'
import { requireAdminRole } from '@/lib/auth/guards'
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
// This endpoint flips the refund initiation model from "operator
// pushes money in the CloudPayments dashboard, then manually records
// the reversal here" to "operator hits this endpoint, the server
// calls CloudPayments' `payments/refund` API on their behalf, books
// the reversal on Success=true." Settlement on the bank side is still
// async and surfaces via CP's `Refund` webhook notification — that
// path is out of scope for this wave; today the audit log + the
// `gateway_transaction_id` breadcrumb on the reversal row is enough
// for operator reconciliation via the CP dashboard.
//
// Behind the feature flag `BILLING_REFUND_GATEWAY_ENABLED`. Default
// false. When the flag is off the endpoint returns 503 so prod can't
// accidentally fire the API call.
//
// The flow holds a row lock on `payment_allocations` for the whole
// duration including the external CP call. This serializes
// concurrent initiations against the same allocation so the bank can
// never receive two refunds whose SUM exceeds the captured amount.
// Refund volume is operator-initiated and low, so the long-held lock
// is acceptable here (the manual endpoint uses the same pattern).
//
// Scope: kind='lesson_slot' only for now. kind='package' refunds
// have extra restore-side-effects (Wave 53's
// restoreAllConsumptionsForPurchase) that need a separate design
// pass on top of the gateway-initiated path. Today the operator
// goes through the manual endpoint for package refunds.

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
  const client = await pool.connect()
  try {
    await client.query('begin')

    // Lock the allocation row for the full duration of the CP call +
    // reversal insert. Same FOR UPDATE pattern as the manual endpoint
    // (Wave 54 Codex review HIGH) — serializes concurrent initiations
    // against the same alloc, so the CP gateway can never see two
    // overlapping refunds whose SUM exceeds the captured amount.
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

    // Look up the original CP TransactionId on the order. The webhook
    // handler stamped this on the `payment.paid` transition (see
    // `lib/payments/provider/lifecycle.ts:markOrderPaid`). Missing
    // means the original payment didn't pass through our CP flow —
    // could be a legacy / mock / external order. Refuse with 422 so
    // the operator falls back to the manual flow.
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
    const transactionId = orderRow.rows[0].provider_transaction_id
      ? String(orderRow.rows[0].provider_transaction_id)
      : null
    if (!transactionId) {
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

    // Call CloudPayments. Refund amount is in RUB decimal. The CP API
    // accepts partial refunds against the same transaction as long as
    // SUM(refunds at CP) <= captured amount, mirroring our own bounds
    // check above.
    const cpResult = await refundTransaction({
      transactionId,
      amount: refundedKopecks / 100,
      jsonData: JSON.stringify({
        invoiceId: paymentOrderId,
        kind,
        targetId,
        reason,
      }),
    })

    if (cpResult.kind !== 'success') {
      await client.query('rollback')
      const status = cpResult.kind === 'declined' ? 502 : 503
      // Best-effort audit on the failure path. The reversal was NOT
      // booked, no money moved — operator should see the failure in
      // the response and in the audit log.
      try {
        await recordPaymentAuditEvent({
          eventType: 'payment.refund.initiated.gateway',
          invoiceId: paymentOrderId,
          customerEmail: orderRow.rows[0].customer_email
            ? String(orderRow.rows[0].customer_email)
            : null,
          amountKopecks: refundedKopecks,
          toStatus: null,
          actor: 'admin',
          payload: {
            allocationKey: { paymentOrderId, kind, targetId },
            transactionId,
            outcome: cpResult.kind,
            cpMessage: 'message' in cpResult ? cpResult.message : null,
            cpReasonCode:
              'reasonCode' in cpResult ? cpResult.reasonCode : null,
          },
        })
      } catch (auditErr) {
        console.warn('[admin.refunds.gateway.audit] failed', {
          paymentOrderId,
          error: auditErr instanceof Error ? auditErr.message : String(auditErr),
        })
      }
      return NextResponse.json(
        {
          error:
            cpResult.kind === 'declined'
              ? 'gateway_declined'
              : 'gateway_error',
          message: 'message' in cpResult ? cpResult.message : 'Gateway error.',
          cpReasonCode:
            'reasonCode' in cpResult ? cpResult.reasonCode : null,
        },
        { status, headers: NO_STORE },
      )
    }

    // CP accepted. Book the reversal in the same tx that's still
    // holding the row lock — concurrent initiations are blocked
    // until COMMIT releases it. Stamp `cpResult.transactionId` as a
    // breadcrumb in the audit payload so the operator can correlate
    // with the CP dashboard's refund record.
    const reversal = await createAllocationReversal(client, {
      paymentOrderId,
      kind,
      targetId,
      refundedKopecks,
      refundedByAccountId: guard.account.id,
      reason,
    })
    await client.query('commit')

    try {
      await recordPaymentAuditEvent({
        eventType: 'payment.refund.initiated.gateway',
        invoiceId: paymentOrderId,
        customerEmail: orderRow.rows[0].customer_email
          ? String(orderRow.rows[0].customer_email)
          : null,
        amountKopecks: refundedKopecks,
        toStatus: 'refunded',
        actor: 'admin',
        payload: {
          allocationKey: { paymentOrderId, kind, targetId },
          transactionId,
          gatewayRefundTransactionId: cpResult.transactionId,
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
        gatewayRefundTransactionId: cpResult.transactionId,
      },
      { status: 201, headers: NO_STORE },
    )
  } catch (err) {
    await client.query('rollback').catch(() => {})
    console.warn('[admin.refunds.gateway] unexpected error', {
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
