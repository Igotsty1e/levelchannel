import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { POST as loginHandler } from '@/app/api/auth/login/route'
import { POST as registerHandler } from '@/app/api/auth/register/route'
import {
  getAccountByEmail,
  grantAccountRole,
  markAccountVerified,
} from '@/lib/auth/accounts'
import { runRefundReconcile } from '@/lib/billing/refund-reconcile'
import { getDbPool } from '@/lib/db/pool'

import '../setup'
import { buildRequest, extractSessionCookie, freshInvoiceId } from '../helpers'

// Wave 61 — refund reconcile worker. Closes Codex Wave 60 round 2
// RESIDUAL HIGH #2.
//
// Two branches:
//   1. gateway_succeeded_db_failed → re-attempt the reversal,
//      transition to succeeded. Audit emits the reserved
//      payment.refund.gateway.webhook event.
//   2. pending older than threshold → mark error with a diagnostic
//      message; operator manually checks the CP dashboard.

beforeAll(() => {
  process.env.BILLING_WAVE_ACTIVE = 'true'
})

afterAll(() => {
  delete process.env.BILLING_WAVE_ACTIVE
})

async function regAdmin() {
  const email = `reconcile-admin-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`
  const password = 'StrongPassword123'
  await registerHandler(
    buildRequest('/api/auth/register', {
      body: { email, password, personalDataConsentAccepted: true },
    }),
  )
  const created = await getAccountByEmail(email)
  await markAccountVerified(created!.id)
  await grantAccountRole(created!.id, 'admin', null)
  const login = await loginHandler(
    buildRequest('/api/auth/login', { body: { email, password } }),
  )
  return {
    cookie: extractSessionCookie(login.headers.get('Set-Cookie'))!,
    accountId: created!.id,
  }
}

async function seedAllocation(opts: {
  amountKopecks: number
}): Promise<{ paymentOrderId: string; slotId: string }> {
  const pool = getDbPool()
  const invoiceId = freshInvoiceId('lc_reconcile')
  const slotId =
    'aaaaaaaa-aaaa-aaaa-aaaa-' +
    Date.now().toString(16).padStart(12, '0').slice(-12) +
    Math.floor(Math.random() * 9).toString(16)
  await pool.query(
    `insert into payment_orders
       (invoice_id, amount_rub, currency, description, provider, status,
        created_at, updated_at, paid_at, customer_email, receipt_email,
        receipt, provider_transaction_id)
     values ($1, $2, 'RUB', 'reconcile test', 'mock', 'paid',
             now(), now(), now(), $3, $3, '{}'::jsonb, 'cp-tx-orig')`,
    [invoiceId, (opts.amountKopecks / 100).toFixed(2), 'r@example.com'],
  )
  await pool.query(
    `insert into payment_allocations
       (payment_order_id, kind, target_id, amount_kopecks)
     values ($1, 'lesson_slot', $2, $3)`,
    [invoiceId, slotId, opts.amountKopecks],
  )
  return { paymentOrderId: invoiceId, slotId }
}

async function seedStuckAttempt(opts: {
  operatorAccountId: string
  paymentOrderId: string
  slotId: string
  refundedKopecks: number
  gatewayTxId: string
}): Promise<string> {
  const pool = getDbPool()
  const res = await pool.query(
    `insert into payment_refund_attempts
       (payment_order_id, kind, target_id, refunded_kopecks,
        operator_account_id, status, original_transaction_id,
        gateway_refund_transaction_id, gateway_message)
     values ($1, 'lesson_slot', $2, $3, $4,
             'gateway_succeeded_db_failed', 'cp-tx-orig', $5,
             'simulated DB failure after CP success')
     returning id`,
    [
      opts.paymentOrderId,
      opts.slotId,
      opts.refundedKopecks,
      opts.operatorAccountId,
      opts.gatewayTxId,
    ],
  )
  return String(res.rows[0].id)
}

async function seedPendingAttempt(opts: {
  operatorAccountId: string
  paymentOrderId: string
  slotId: string
  refundedKopecks: number
  ageMinutes: number
}): Promise<string> {
  const pool = getDbPool()
  const res = await pool.query(
    `insert into payment_refund_attempts
       (payment_order_id, kind, target_id, refunded_kopecks,
        operator_account_id, status, original_transaction_id,
        created_at, updated_at)
     values ($1, 'lesson_slot', $2, $3, $4,
             'pending', 'cp-tx-orig',
             now() - make_interval(mins => $5::int),
             now() - make_interval(mins => $5::int))
     returning id`,
    [
      opts.paymentOrderId,
      opts.slotId,
      opts.refundedKopecks,
      opts.operatorAccountId,
      opts.ageMinutes,
    ],
  )
  return String(res.rows[0].id)
}

async function fetchAttempt(attemptId: string) {
  const pool = getDbPool()
  const r = await pool.query(
    `select id, status, reversal_id, gateway_message
       from payment_refund_attempts where id = $1`,
    [attemptId],
  )
  return r.rows[0] ?? null
}

describe('runRefundReconcile — Branch A (gateway_succeeded_db_failed)', () => {
  it('books the missing reversal + transitions attempt to succeeded', async () => {
    const admin = await regAdmin()
    const { paymentOrderId, slotId } = await seedAllocation({
      amountKopecks: 350000,
    })
    const attemptId = await seedStuckAttempt({
      operatorAccountId: admin.accountId,
      paymentOrderId,
      slotId,
      refundedKopecks: 350000,
      gatewayTxId: 'cp-refund-tx-1111',
    })

    const { summary } = await runRefundReconcile()
    expect(summary.reversed).toBeGreaterThanOrEqual(1)

    // Attempt terminal=succeeded, reversal_id populated.
    const after = await fetchAttempt(attemptId)
    expect(after.status).toBe('succeeded')
    expect(after.reversal_id).not.toBeNull()
    expect(after.gateway_message).toBeNull()

    // Reversal row exists.
    const pool = getDbPool()
    const rev = await pool.query(
      `select id from payment_allocation_reversals
        where payment_order_id = $1 and kind = $2 and target_id = $3`,
      [paymentOrderId, 'lesson_slot', slotId],
    )
    expect(rev.rows.length).toBe(1)
    expect(String(rev.rows[0].id)).toBe(after.reversal_id)

    // Audit row written with the reserved event_type.
    const audit = await pool.query(
      `select event_type, payload
         from payment_audit_events
        where invoice_id = $1 and event_type = 'payment.refund.gateway.webhook'
        order by created_at desc
        limit 1`,
      [paymentOrderId],
    )
    expect(audit.rows.length).toBe(1)
    expect(audit.rows[0].payload.attemptId).toBe(attemptId)
    expect(audit.rows[0].payload.source).toBe(
      'reconcile.gateway_succeeded_db_failed',
    )
  })

  it('on sum-bounds collision leaves attempt in same state with diagnostic message', async () => {
    const admin = await regAdmin()
    const { paymentOrderId, slotId } = await seedAllocation({
      amountKopecks: 100000,
    })
    // Simulate a manual refund already booked for the full amount —
    // a subsequent gateway_succeeded_db_failed for 100k more would
    // overflow.
    const pool = getDbPool()
    await pool.query(
      `insert into payment_allocation_reversals
         (payment_order_id, kind, target_id,
          refunded_kopecks, refunded_by_account_id)
       values ($1, 'lesson_slot', $2, 100000, $3)`,
      [paymentOrderId, slotId, admin.accountId],
    )
    const attemptId = await seedStuckAttempt({
      operatorAccountId: admin.accountId,
      paymentOrderId,
      slotId,
      refundedKopecks: 100000,
      gatewayTxId: 'cp-refund-tx-2222',
    })

    const { summary } = await runRefundReconcile()
    expect(summary.reconcileCollisions).toBeGreaterThanOrEqual(1)

    const after = await fetchAttempt(attemptId)
    // Still in the gateway_succeeded_db_failed bucket — operator
    // takes it from here.
    expect(after.status).toBe('gateway_succeeded_db_failed')
    expect(after.gateway_message).toContain('manual reconciliation required')
    expect(after.reversal_id).toBeNull()
  })
})

describe('runRefundReconcile — Branch B (pending timeout)', () => {
  it('marks pending older than threshold as error', async () => {
    const admin = await regAdmin()
    const { paymentOrderId, slotId } = await seedAllocation({
      amountKopecks: 50000,
    })
    // 45 minutes old — older than the default 30-min threshold.
    const attemptId = await seedPendingAttempt({
      operatorAccountId: admin.accountId,
      paymentOrderId,
      slotId,
      refundedKopecks: 50000,
      ageMinutes: 45,
    })

    const { summary } = await runRefundReconcile({
      pendingTimeoutMinutes: 30,
    })
    expect(summary.pendingTimedOut).toBeGreaterThanOrEqual(1)

    const after = await fetchAttempt(attemptId)
    expect(after.status).toBe('error')
    expect(after.gateway_message).toContain('pending timed out')
    expect(after.gateway_message).toContain('manual reconciliation required')
  })

  it('does NOT touch pending younger than the threshold', async () => {
    const admin = await regAdmin()
    const { paymentOrderId, slotId } = await seedAllocation({
      amountKopecks: 50000,
    })
    // 5 minutes old — younger than the 30-min threshold.
    const attemptId = await seedPendingAttempt({
      operatorAccountId: admin.accountId,
      paymentOrderId,
      slotId,
      refundedKopecks: 50000,
      ageMinutes: 5,
    })

    await runRefundReconcile({ pendingTimeoutMinutes: 30 })
    const after = await fetchAttempt(attemptId)
    expect(after.status).toBe('pending')
  })
})

describe('runRefundReconcile — idempotency', () => {
  it('re-running on already-terminal rows is a no-op', async () => {
    const admin = await regAdmin()
    const { paymentOrderId, slotId } = await seedAllocation({
      amountKopecks: 200000,
    })
    const attemptId = await seedStuckAttempt({
      operatorAccountId: admin.accountId,
      paymentOrderId,
      slotId,
      refundedKopecks: 200000,
      gatewayTxId: 'cp-refund-tx-3333',
    })
    // First run: reversal booked, attempt → succeeded.
    await runRefundReconcile()
    const after1 = await fetchAttempt(attemptId)
    expect(after1.status).toBe('succeeded')
    const reversalId1 = after1.reversal_id

    // Second run: terminal row no longer matches the predicate.
    const { summary } = await runRefundReconcile()
    // No NEW reversals from this run (the candidate query filters
    // out 'succeeded' rows).
    const after2 = await fetchAttempt(attemptId)
    expect(after2.status).toBe('succeeded')
    expect(after2.reversal_id).toBe(reversalId1)
    expect(summary.reversed).toBe(0)
  })
})
