import { NextResponse } from 'next/server'

import { readJsonObjectOr400 } from '@/lib/api/json-body'
import { recordPaymentAuditEvent } from '@/lib/audit/payment-events'
import { requireAdminRole } from '@/lib/auth/guards'
import { createAllocationReversal } from '@/lib/billing/reversals'
import { getDbPool } from '@/lib/db/pool'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
} from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' }

// Refund Phase 7 Stage B — admin endpoint that books a reversal
// against an existing payment_allocations row.
//
// Today's flow: operator hits CloudPayments dashboard to push the
// actual money back, then calls this endpoint to record the reversal
// in our DB. This endpoint does NOT initiate the CloudPayments-side
// refund — money movement stays operator-driven, the DB just learns
// about it after the fact. Decoupling is intentional: refund settlement
// on the bank side can take days; the operator should be free to
// record the reversal before the funds settle, or after, without
// blocking on payment-gateway state.
//
// Scope: kind='lesson_slot' allocations only. kind='package' refunds
// need to also restore every active consumption on the package_purchase;
// that's a follow-up stage with its own design + test matrix.
//
// Idempotency: UNIQUE(payment_order_id, kind, target_id) on
// payment_allocation_reversals (migration 0036) catches retries. A
// duplicate submit returns 409 'already_refunded' with the existing
// reversal row id so the operator can see what's there.
//
// Note: this is NOT a public-facing endpoint. No /api/account/refunds
// surface — refund requests come in by email and the operator decides
// per-case.

type RefundRequestBody = {
  paymentOrderId?: string
  kind?: string
  targetId?: string
  refundedKopecks?: number
  reason?: string | null
  refundedAtIso?: string | null
}

export async function POST(request: Request) {
  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate

  const rl = await enforceRateLimit(request, 'admin:refunds:ip', 20, 60_000)
  if (rl) return rl

  const guard = await requireAdminRole(request)
  if (!guard.ok) return guard.response

  const parsed = await readJsonObjectOr400(request)
  if (!parsed.ok) return parsed.response
  const body = parsed.body as RefundRequestBody

  const paymentOrderId = typeof body.paymentOrderId === 'string' ? body.paymentOrderId : ''
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
        message: `Refund for kind='${kind}' is not implemented yet — only 'lesson_slot' is supported in Stage B.`,
      },
      { status: 400, headers: NO_STORE },
    )
  }
  let refundedAt: Date | undefined
  if (body.refundedAtIso) {
    const parsedDate = new Date(body.refundedAtIso)
    if (Number.isNaN(parsedDate.getTime())) {
      return NextResponse.json(
        { error: 'invalid_refunded_at', message: 'refundedAtIso must be ISO 8601' },
        { status: 400, headers: NO_STORE },
      )
    }
    refundedAt = parsedDate
  }

  const pool = getDbPool()
  const client = await pool.connect()
  try {
    await client.query('begin')

    // Look up the allocation in the same tx — abort if missing AND
    // assert refundedKopecks ≤ allocation amount.
    const allocRow = await client.query(
      `select amount_kopecks
         from payment_allocations
        where payment_order_id = $1 and kind = $2 and target_id = $3`,
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
    // Stage B is full-refund-only by design. Migration 0036 documents
    // "Partial / amount-only reversals are out of scope for Stage A —
    // they require the SUM-over-reversals refactor" and the read paths
    // (slotIsPaidByAllocations / listSlotPaidStatus / debt query) drop
    // the allocation on REVERSAL ROW EXISTENCE, not on amount match.
    // Accepting refundedKopecks < amount would flip a slot to "unpaid"
    // even though only 1 kopeck was refunded — a real data bug.
    // Codex Wave 51 review HIGH. Reject anything that isn't the full
    // amount; the operator hits this branch when CloudPayments only
    // partially refunded (rare; today operator can fall back to manual
    // CloudPayments-dashboard status flip on payment_orders).
    const allocAmount = Number(allocRow.rows[0].amount_kopecks)
    if (refundedKopecks !== allocAmount) {
      await client.query('rollback')
      const code =
        refundedKopecks > allocAmount
          ? 'refund_exceeds_allocation'
          : 'partial_refund_not_supported'
      return NextResponse.json(
        {
          error: code,
          message: `refundedKopecks=${refundedKopecks} must equal allocation amount=${allocAmount} (Stage B is full-refund-only).`,
        },
        { status: 400, headers: NO_STORE },
      )
    }

    let reversal
    try {
      reversal = await createAllocationReversal(client, {
        paymentOrderId,
        kind,
        targetId,
        refundedKopecks,
        refundedByAccountId: guard.account.id,
        reason,
        refundedAt,
      })
    } catch (err) {
      const code = (err as { code?: string } | null)?.code ?? ''
      if (code === '23505') {
        // Already reversed. Fetch existing to surface the id.
        await client.query('rollback')
        const existing = await pool.query(
          `select id from payment_allocation_reversals
            where payment_order_id = $1 and kind = $2 and target_id = $3`,
          [paymentOrderId, kind, targetId],
        )
        return NextResponse.json(
          {
            error: 'already_refunded',
            message: 'A reversal for this allocation already exists.',
            reversalId: existing.rows[0]?.id ?? null,
          },
          { status: 409, headers: NO_STORE },
        )
      }
      throw err
    }

    await client.query('commit')

    // Audit on the same pool (audit table has best-effort writes via
    // getAuditPool; not on the tx client). Best-effort: a failure
    // logs but doesn't roll back the reversal — the reversal row is
    // the load-bearing record, the audit row is the human breadcrumb.
    try {
      await recordPaymentAuditEvent({
        eventType: 'payment.refund.recorded',
        invoiceId: paymentOrderId,
        customerEmail: null,
        amountKopecks: refundedKopecks,
        toStatus: 'refunded',
        actor: 'admin',
        payload: {
          allocationKey: { paymentOrderId, kind, targetId },
          reversalId: reversal.id,
          reason,
        },
      })
    } catch (auditErr) {
      console.warn('[admin.refunds.audit] failed', {
        reversalId: reversal.id,
        error: auditErr instanceof Error ? auditErr.message : String(auditErr),
      })
    }

    return NextResponse.json(
      { reversal },
      { status: 201, headers: NO_STORE },
    )
  } catch (err) {
    await client.query('rollback').catch(() => {})
    console.warn('[admin.refunds] unexpected error', {
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
