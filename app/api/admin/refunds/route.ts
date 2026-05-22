import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { readJsonObjectOr400 } from '@/lib/api/json-body'
import { recordPaymentAuditEvent } from '@/lib/audit/payment-events'
import { requireAdminRole } from '@/lib/auth/guards'
import { restoreAllConsumptionsForPurchase } from '@/lib/billing/consumption'
import {
  createAllocationReversal,
  listRecentReversals,
} from '@/lib/billing/reversals'
import { getDbPool } from '@/lib/db/pool'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
} from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'


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
  if (kind !== 'lesson_slot' && kind !== 'package') {
    return NextResponse.json(
      {
        error: 'unsupported_kind',
        message: `Refund for kind='${kind}' is not supported — only 'lesson_slot' and 'package' are.`,
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

  // PKG-ADMIN-GRANT (2026-05-16) — admin grants are NOT money flow.
  // payment_orders.provider='admin_grant' carries no actual charge to
  // reverse; allowing this route to "refund" it would book a phantom
  // reversal against a 0-RUB synthetic order. Operators void admin
  // grants via PKG-ADMIN-VOID (follow-up wave), NOT this route.
  //
  // SAAS-PIVOT Epic 3 Day 4 (2026-05-22, round-29 BLOCKER closure):
  // Same rejection extended to 'teacher_grant' rows. Teacher-driven
  // non-money grants are revoked via /teacher/packages/[id]/revoke
  // (or /admin/teacher-grant/[id]/revoke for operator override),
  // not via this refund route. Booking a reversal against either
  // grant kind would corrupt the audit trail.
  //
  // We DON'T 404 here on missing order — leave that to the existing
  // allocation_not_found path so the public contract for "no such
  // order" is preserved. Only refuse when the order EXISTS but is
  // a non-money provider.
  const providerRow = await pool.query(
    `select provider from payment_orders where invoice_id = $1`,
    [paymentOrderId],
  )
  if (providerRow.rows.length > 0) {
    const provider = providerRow.rows[0].provider
    if (provider === 'admin_grant' || provider === 'teacher_grant') {
      return NextResponse.json(
        {
          error: 'non_money_order_not_refundable',
          message:
            provider === 'admin_grant'
              ? 'Этот заказ — admin grant (не платный). Используйте PKG-ADMIN-VOID для отмены, а не маршрут возвратов.'
              : 'Этот заказ не платный — для отмены воспользуйтесь revoke в кабинете учителя.',
          provider,
        },
        { status: 422, headers: NO_STORE },
      )
    }
  }

  const client = await pool.connect()
  try {
    await client.query('begin')

    // Look up the allocation in the same tx — abort if missing AND
    // assert refundedKopecks ≤ allocation amount.
    //
    // Wave 54 Codex review HIGH — concurrency. Two operators submitting
    // partial refunds against the same allocation could each read the
    // running sum as 0 under READ COMMITTED, both pass the bounds check,
    // and together push SUM(refunded_kopecks) past amount_kopecks now
    // that the UNIQUE(payment_order_id, kind, target_id) constraint is
    // gone (migration 0039). `FOR UPDATE` on the allocation row
    // serializes refunds against the same composite key for the lifetime
    // of the tx — the SUM read, the bounds check, and the reversal
    // INSERT all sit behind the lock.
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
    // Wave 54 — partial reversals supported. The read paths SUM all
    // reversal rows for an allocation and compare to its amount;
    // partial refund keeps the slot in the paid bucket, a sequence
    // whose SUM hits the amount flips it to refunded. Read existing
    // sum to assert this refund doesn't push the running total past
    // the allocation amount.
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
    // Package refunds remain full-amount-only for now: voiding the
    // package_purchase only makes sense when the full purchase price
    // is being returned. A partial package refund needs a different
    // model (e.g., proportional consumption restore) that isn't in
    // scope here.
    if (kind === 'package' && refundedKopecks !== allocAmount) {
      await client.query('rollback')
      return NextResponse.json(
        {
          error: 'partial_package_refund_not_supported',
          message: `Package refunds must be full-amount; got ${refundedKopecks} of ${allocAmount}.`,
        },
        { status: 400, headers: NO_STORE },
      )
    }

    let reversal
    let packageRestore: { restoredCount: number; alreadyVoided: boolean } | null = null
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
      // Wave 53 — kind='package' refund must also void the
      // package_purchase + restore every active consumption on it
      // (slots booked from this package lose their "paid via
      // package" backing; operator handles downstream slot
      // disposition). Same tx as the reversal insert.
      if (kind === 'package') {
        packageRestore = await restoreAllConsumptionsForPurchase(client, {
          packagePurchaseId: targetId,
          actor: 'admin',
          reason: reason ?? 'admin_package_refund',
        })
      }
    } catch (err) {
      const code = (err as { code?: string } | null)?.code ?? ''
      if (code === '23505') {
        // Wave 54 removed the UNIQUE(payment_order_id, kind, target_id)
        // index, so this branch should no longer fire. If it does,
        // something else hit a unique constraint — surface as 409 with
        // the row count for diagnostics, but don't claim "already
        // refunded" because the new model permits N reversals.
        await client.query('rollback')
        const existing = await pool.query(
          `select id from payment_allocation_reversals
            where payment_order_id = $1 and kind = $2 and target_id = $3`,
          [paymentOrderId, kind, targetId],
        )
        return NextResponse.json(
          {
            error: 'unique_violation',
            message: 'Unexpected unique-violation on reversal insert.',
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
      {
        reversal,
        // Wave 53 — kind='package' refund also surfaces how many
        // consumptions were restored (operator may need to follow up
        // with slot cancellations for those bookings).
        ...(packageRestore
          ? {
              packageRestored: {
                restoredConsumptions: packageRestore.restoredCount,
                alreadyVoided: packageRestore.alreadyVoided,
              },
            }
          : {}),
      },
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

// Wave 64 — admin listing of recent reversals. Lists the
// payment_allocation_reversals table newest-first with the operator
// email joined for display. Mirrors the read-only pattern used by
// /api/admin/debt-summary; admin role + rate-limit gate; no mutation.
//
// Query params:
//   limit (default 50, max 500)
//   offset (default 0)
export async function GET(request: Request) {
  const rl = await enforceRateLimit(request, 'admin:refunds:list:ip', 30, 60_000)
  if (rl) return rl

  const guard = await requireAdminRole(request)
  if (!guard.ok) return guard.response

  const url = new URL(request.url)
  const limitRaw = Number(url.searchParams.get('limit') ?? '50')
  const offsetRaw = Number(url.searchParams.get('offset') ?? '0')
  const limit =
    Number.isFinite(limitRaw) && limitRaw > 0
      ? Math.min(Math.floor(limitRaw), 500)
      : 50
  const offset =
    Number.isFinite(offsetRaw) && offsetRaw >= 0 ? Math.floor(offsetRaw) : 0

  const rows = await listRecentReversals({ limit, offset })
  return NextResponse.json(
    {
      rows,
      page: { limit, offset, count: rows.length },
    },
    { status: 200, headers: NO_STORE },
  )
}
