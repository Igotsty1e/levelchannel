#!/usr/bin/env node
//
// Wave 61 — refund reconcile worker. Drives the non-terminal rows
// in `payment_refund_attempts` through the two reconcile branches:
//
//   1. status='gateway_succeeded_db_failed' — CP accepted the bank
//      refund but our follow-up reversal insert errored at the
//      route. Re-attempt the reversal here. If a manual refund
//      raced in and sum-bounds would overflow, stamp a diagnostic
//      message and leave the attempt in the same state for
//      operator-side reconciliation.
//
//   2. status='pending' older than PENDING_TIMEOUT_MINUTES (default
//      30 min). Mark as 'error' with a timeout message; operator
//      verifies via CP dashboard.
//
// The canonical logic lives in `lib/billing/refund-reconcile.ts`.
// This mjs runner inlines equivalent SQL because the systemd timer
// can't import TS directly. Both files must stay in sync — if you
// edit the predicate here, edit it there too, and vice versa.
//
// Runs as a systemd timer (see scripts/systemd/levelchannel-refund-
// reconcile.{service,timer}). Suggested cadence: every 5 minutes.
//
// Audit event: `payment.refund.gateway.webhook` (reserved in
// migration 0040; the future CP `Refund` webhook handler emits the
// same kind).

import pg from 'pg'

import { resolveSslConfig } from './_pg-ssl.mjs'

const PENDING_TIMEOUT_MINUTES = Number.parseInt(
  process.env.REFUND_RECONCILE_PENDING_TIMEOUT_MINUTES || '30',
  10,
)
const BATCH_SIZE = Number.parseInt(
  process.env.REFUND_RECONCILE_BATCH_SIZE || '100',
  10,
)

function logJson(level, message, extra) {
  const payload = {
    ts: new Date().toISOString(),
    level,
    component: 'refund-reconcile',
    message,
    ...extra,
  }
  console.log(JSON.stringify(payload))
}

async function reconcileStuck(pool) {
  const candidates = await pool.query(
    `select id from payment_refund_attempts
      where status = 'gateway_succeeded_db_failed'
      order by created_at asc
      limit $1`,
    [BATCH_SIZE],
  )
  let reversed = 0
  let collisions = 0
  let errors = 0
  for (const row of candidates.rows) {
    const id = String(row.id)
    const client = await pool.connect()
    try {
      await client.query('begin')
      const attemptRes = await client.query(
        `select id, payment_order_id, kind, target_id, refunded_kopecks,
                operator_account_id, gateway_refund_transaction_id, reason
           from payment_refund_attempts
          where id = $1
            and status = 'gateway_succeeded_db_failed'
          for update`,
        [id],
      )
      if (attemptRes.rows.length === 0) {
        await client.query('rollback')
        continue
      }
      const a = attemptRes.rows[0]
      const allocRes = await client.query(
        `select amount_kopecks
           from payment_allocations
          where payment_order_id = $1 and kind = $2 and target_id = $3
          for update`,
        [a.payment_order_id, a.kind, a.target_id],
      )
      if (allocRes.rows.length === 0) {
        await client.query(
          `update payment_refund_attempts
              set status = 'error',
                  gateway_message = 'reconcile: allocation row missing',
                  updated_at = now()
            where id = $1`,
          [id],
        )
        await client.query('commit')
        errors += 1
        logJson('warn', 'attempt allocation missing', { attemptId: id })
        continue
      }
      const allocAmount = Number(allocRes.rows[0].amount_kopecks)
      const priorRes = await client.query(
        `select coalesce(sum(refunded_kopecks), 0)::bigint as sum
           from payment_allocation_reversals
          where payment_order_id = $1 and kind = $2 and target_id = $3`,
        [a.payment_order_id, a.kind, a.target_id],
      )
      const priorRefunded = Number(priorRes.rows[0]?.sum ?? 0)
      const refundedKopecks = Number(a.refunded_kopecks)
      if (priorRefunded + refundedKopecks > allocAmount) {
        await client.query(
          `update payment_refund_attempts
              set gateway_message =
                    'reconcile: prior=' || $2::text ||
                    ' + this=' || $3::text ||
                    ' > allocation=' || $4::text ||
                    '; manual reconciliation required',
                  updated_at = now()
            where id = $1`,
          [id, priorRefunded, refundedKopecks, allocAmount],
        )
        await client.query('commit')
        collisions += 1
        logJson('warn', 'reconcile collision — manual reconciliation required', {
          attemptId: id,
          priorRefunded,
          refundedKopecks,
          allocAmount,
        })
        continue
      }
      const reversalRes = await client.query(
        `insert into payment_allocation_reversals
           (payment_order_id, kind, target_id,
            refunded_kopecks, refunded_by_account_id, reason)
         values ($1, $2, $3, $4, $5, $6)
         returning id`,
        [
          a.payment_order_id,
          a.kind,
          a.target_id,
          refundedKopecks,
          a.operator_account_id,
          a.reason,
        ],
      )
      const reversalId = String(reversalRes.rows[0].id)
      await client.query(
        `update payment_refund_attempts
            set status = 'succeeded',
                reversal_id = $2,
                gateway_message = null,
                updated_at = now()
          where id = $1`,
        [id, reversalId],
      )
      await client.query('commit')
      reversed += 1
      logJson('info', 'reversal booked from reconcile', {
        attemptId: id,
        reversalId,
        gatewayRefundTransactionId: String(a.gateway_refund_transaction_id),
      })
      // Best-effort audit on a fresh connection.
      try {
        await pool.query(
          `insert into payment_audit_events
             (event_type, invoice_id, amount_kopecks, to_status, actor, payload)
           values ($1, $2, $3, $4, $5, $6::jsonb)`,
          [
            'payment.refund.gateway.webhook',
            String(a.payment_order_id),
            refundedKopecks,
            'refunded',
            'admin',
            JSON.stringify({
              allocationKey: {
                paymentOrderId: String(a.payment_order_id),
                kind: String(a.kind),
                targetId: String(a.target_id),
              },
              attemptId: id,
              gatewayRefundTransactionId: String(
                a.gateway_refund_transaction_id,
              ),
              reversalId,
              source: 'reconcile.gateway_succeeded_db_failed',
            }),
          ],
        )
      } catch (auditErr) {
        logJson('warn', 'audit insert failed', {
          attemptId: id,
          error: auditErr instanceof Error ? auditErr.message : String(auditErr),
        })
      }
    } catch (err) {
      await client.query('rollback').catch(() => {})
      errors += 1
      logJson('error', 'reconcile failed', {
        attemptId: id,
        error: err instanceof Error ? err.message : String(err),
      })
    } finally {
      client.release()
    }
  }
  return { reversed, collisions, errors }
}

async function reconcilePendingTimeout(pool) {
  const res = await pool.query(
    `update payment_refund_attempts
        set status = 'error',
            gateway_message =
              'reconcile: pending timed out after ' ||
              extract(epoch from (now() - created_at))::int || 's; ' ||
              'manual reconciliation required via CP dashboard',
            updated_at = now()
      where status = 'pending'
        and created_at < now() - make_interval(mins => $1::int)`,
    [PENDING_TIMEOUT_MINUTES],
  )
  if ((res.rowCount ?? 0) > 0) {
    logJson('warn', 'pending timeouts marked error', {
      count: res.rowCount,
      pendingTimeoutMinutes: PENDING_TIMEOUT_MINUTES,
    })
  }
  return res.rowCount ?? 0
}

async function main() {
  if (!process.env.DATABASE_URL) {
    logJson('error', 'DATABASE_URL not set')
    process.exitCode = 2
    return
  }
  const ssl = resolveSslConfig(process.env.DATABASE_URL)
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 4,
    ssl: ssl || undefined,
  })
  try {
    const stuck = await reconcileStuck(pool)
    const pendingTimedOut = await reconcilePendingTimeout(pool)
    logJson('info', 'reconcile completed', {
      reversed: stuck.reversed,
      collisions: stuck.collisions,
      errors: stuck.errors,
      pendingTimedOut,
    })
    if (stuck.errors > 0) {
      // Non-zero exit so systemd flags the run as degraded without
      // tearing down the timer (`Type=oneshot` keeps the unit alive).
      process.exitCode = 1
    }
  } finally {
    await pool.end()
  }
}

main().catch((err) => {
  logJson('error', 'reconcile fatal', {
    error: err instanceof Error ? err.message : String(err),
  })
  process.exitCode = 3
})
