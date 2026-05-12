// Wave 60 follow-up (Codex HIGH #2 / MEDIUM #4) — durable refund
// attempt records for the gateway-initiated refund path.
//
// The endpoint writes a row BEFORE the CP API call so that a crash
// between "CP says success" and "our reversal is booked" leaves a
// breadcrumb for reconciliation. The reconcile job (or the future
// `Refund` settlement webhook) walks non-terminal rows oldest first.

import type { PoolClient } from 'pg'

import { getDbPool } from '@/lib/db/pool'

export type RefundAttemptStatus =
  | 'pending'
  | 'succeeded'
  | 'gateway_succeeded_db_failed'
  | 'declined'
  | 'error'

export type RefundAttempt = {
  id: string
  paymentOrderId: string
  kind: string
  targetId: string
  refundedKopecks: number
  operatorAccountId: string
  idempotencyKey: string | null
  status: RefundAttemptStatus
  originalTransactionId: string
  gatewayRefundTransactionId: string | null
  reversalId: string | null
  reason: string | null
  gatewayMessage: string | null
  gatewayReasonCode: string | null
  createdAt: string
  updatedAt: string
}

const ATTEMPT_COLS =
  'id, payment_order_id, kind, target_id, refunded_kopecks, ' +
  'operator_account_id, idempotency_key, status, original_transaction_id, ' +
  'gateway_refund_transaction_id, reversal_id, reason, gateway_message, ' +
  'gateway_reason_code, created_at, updated_at'

function rowToAttempt(row: Record<string, unknown>): RefundAttempt {
  return {
    id: String(row.id),
    paymentOrderId: String(row.payment_order_id),
    kind: String(row.kind),
    targetId: String(row.target_id),
    refundedKopecks: Number(row.refunded_kopecks),
    operatorAccountId: String(row.operator_account_id),
    idempotencyKey: row.idempotency_key ? String(row.idempotency_key) : null,
    status: String(row.status) as RefundAttemptStatus,
    originalTransactionId: String(row.original_transaction_id),
    gatewayRefundTransactionId: row.gateway_refund_transaction_id
      ? String(row.gateway_refund_transaction_id)
      : null,
    reversalId: row.reversal_id ? String(row.reversal_id) : null,
    reason: row.reason ? String(row.reason) : null,
    gatewayMessage: row.gateway_message ? String(row.gateway_message) : null,
    gatewayReasonCode: row.gateway_reason_code
      ? String(row.gateway_reason_code)
      : null,
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  }
}

// Read-only lookup for idempotency replay. Returns the cached
// attempt when (operator, idempotency_key) already exists. Caller
// uses this BEFORE locking the allocation row so a replay short-
// circuits without re-running the sum-bounds check (a successful
// first attempt may have exhausted the allocation, which would
// otherwise reject the replay with refund_exceeds_allocation).
export async function findRefundAttemptByIdempotency(
  operatorAccountId: string,
  idempotencyKey: string,
): Promise<RefundAttempt | null> {
  const pool = getDbPool()
  const result = await pool.query(
    `select ${ATTEMPT_COLS}
       from payment_refund_attempts
      where operator_account_id = $1 and idempotency_key = $2`,
    [operatorAccountId, idempotencyKey],
  )
  if (result.rows.length === 0) return null
  return rowToAttempt(result.rows[0])
}

// Idempotency-aware insert: when `idempotencyKey` is provided and a
// row for (operator, key) already exists, return the existing row
// instead of inserting a duplicate. Empty key means "not idempotent"
// and a fresh row is always inserted.
export async function createPendingRefundAttempt(
  client: PoolClient,
  input: {
    paymentOrderId: string
    kind: string
    targetId: string
    refundedKopecks: number
    operatorAccountId: string
    idempotencyKey: string | null
    originalTransactionId: string
    reason: string | null
  },
): Promise<{ attempt: RefundAttempt; replay: boolean }> {
  if (input.idempotencyKey) {
    const existing = await client.query(
      `select ${ATTEMPT_COLS}
         from payment_refund_attempts
        where operator_account_id = $1 and idempotency_key = $2`,
      [input.operatorAccountId, input.idempotencyKey],
    )
    if (existing.rows.length > 0) {
      return {
        attempt: rowToAttempt(existing.rows[0]),
        replay: true,
      }
    }
  }
  const result = await client.query(
    `insert into payment_refund_attempts
       (payment_order_id, kind, target_id, refunded_kopecks,
        operator_account_id, idempotency_key, status,
        original_transaction_id, reason)
     values ($1, $2, $3, $4, $5, $6, 'pending', $7, $8)
     returning ${ATTEMPT_COLS}`,
    [
      input.paymentOrderId,
      input.kind,
      input.targetId,
      input.refundedKopecks,
      input.operatorAccountId,
      input.idempotencyKey,
      input.originalTransactionId,
      input.reason,
    ],
  )
  return { attempt: rowToAttempt(result.rows[0]), replay: false }
}

export async function markAttemptSucceeded(
  client: PoolClient,
  attemptId: string,
  gatewayRefundTransactionId: string,
  reversalId: string,
): Promise<RefundAttempt> {
  const result = await client.query(
    `update payment_refund_attempts
        set status = 'succeeded',
            gateway_refund_transaction_id = $2,
            reversal_id = $3,
            updated_at = now()
      where id = $1
      returning ${ATTEMPT_COLS}`,
    [attemptId, gatewayRefundTransactionId, reversalId],
  )
  return rowToAttempt(result.rows[0])
}

// CP said success but the follow-up DB work errored. The bank refund
// proceeds; the reconcile job picks this row up.
export async function markAttemptGatewaySucceededDbFailed(
  attemptId: string,
  gatewayRefundTransactionId: string,
  gatewayMessage: string,
): Promise<void> {
  const pool = getDbPool()
  await pool.query(
    `update payment_refund_attempts
        set status = 'gateway_succeeded_db_failed',
            gateway_refund_transaction_id = $2,
            gateway_message = $3,
            updated_at = now()
      where id = $1`,
    [attemptId, gatewayRefundTransactionId, gatewayMessage],
  )
}

export async function markAttemptDeclined(
  client: PoolClient,
  attemptId: string,
  message: string,
  reasonCode: string | null,
): Promise<void> {
  await client.query(
    `update payment_refund_attempts
        set status = 'declined',
            gateway_message = $2,
            gateway_reason_code = $3,
            updated_at = now()
      where id = $1`,
    [attemptId, message, reasonCode],
  )
}

export async function markAttemptError(
  client: PoolClient,
  attemptId: string,
  message: string,
): Promise<void> {
  await client.query(
    `update payment_refund_attempts
        set status = 'error',
            gateway_message = $2,
            updated_at = now()
      where id = $1`,
    [attemptId, message],
  )
}
