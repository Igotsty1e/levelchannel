import { spawnSync } from 'node:child_process'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { listPaymentAuditEventsByInvoice } from '@/lib/audit/payment-events'
import { getDbPool } from '@/lib/db/pool'

import './setup'

// Verifies scripts/cancel-stale-orders.mjs end-to-end:
//   - a pending order older than the threshold is cancelled, gets a
//     payment.cancelled event in payment_orders.events, and gets a
//     matching order.cancelled audit row with actor='system'.
//   - a fresh pending order is left alone.
//   - a paid / failed / cancelled row is left alone.

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..')
const SCRIPT_PATH = path.join(REPO_ROOT, 'scripts', 'cancel-stale-orders.mjs')

async function seedOrder(params: {
  invoiceId: string
  status: 'pending' | 'paid' | 'failed' | 'cancelled'
  ageMinutes: number
  amountRub?: number
}) {
  await getDbPool().query(
    `insert into payment_orders (
       invoice_id, amount_rub, currency, description, provider, status,
       created_at, updated_at, customer_email, receipt_email, receipt
     ) values (
       $1, $2, 'RUB', 'test order', 'cloudpayments', $3,
       now() - make_interval(mins => $4), now(), 'stale@example.com',
       'stale@example.com', '{}'::jsonb
     )`,
    [
      params.invoiceId,
      params.amountRub ?? 1500,
      params.status,
      params.ageMinutes,
    ],
  )
}

function runScript(thresholdMinutes = 60) {
  return spawnSync(process.execPath, [SCRIPT_PATH], {
    env: {
      ...process.env,
      STALE_ORDER_THRESHOLD_MINUTES: String(thresholdMinutes),
    },
    encoding: 'utf8',
  })
}

describe('scripts/cancel-stale-orders.mjs', () => {
  it('cancels a pending order older than the threshold', async () => {
    await seedOrder({
      invoiceId: 'lc_stale_old',
      status: 'pending',
      ageMinutes: 90,
    })

    const result = runScript(60)
    expect(result.status).toBe(0)

    const { rows } = await getDbPool().query(
      `select status, events from payment_orders where invoice_id = $1`,
      ['lc_stale_old'],
    )
    expect(rows[0].status).toBe('cancelled')
    const events = rows[0].events as Array<{ type: string; reason?: string }>
    const last = events[events.length - 1]
    expect(last.type).toBe('payment.cancelled')
    expect(last.reason).toBe('stale_pending_timeout')

    const audit = await listPaymentAuditEventsByInvoice('lc_stale_old')
    const cancelEvent = audit.find((e) => e.eventType === 'order.cancelled')
    expect(cancelEvent).toBeDefined()
    expect(cancelEvent?.actor).toBe('system')
    expect(cancelEvent?.fromStatus).toBe('pending')
    expect(cancelEvent?.toStatus).toBe('cancelled')
  })

  it('leaves a fresh pending order alone', async () => {
    await seedOrder({
      invoiceId: 'lc_stale_fresh',
      status: 'pending',
      ageMinutes: 5,
    })

    runScript(60)

    const { rows } = await getDbPool().query(
      `select status from payment_orders where invoice_id = $1`,
      ['lc_stale_fresh'],
    )
    expect(rows[0].status).toBe('pending')
  })

  it('does not touch terminal-status rows', async () => {
    await seedOrder({
      invoiceId: 'lc_terminal_paid',
      status: 'paid',
      ageMinutes: 200,
    })
    await seedOrder({
      invoiceId: 'lc_terminal_failed',
      status: 'failed',
      ageMinutes: 200,
    })
    await seedOrder({
      invoiceId: 'lc_terminal_cancelled',
      status: 'cancelled',
      ageMinutes: 200,
    })

    runScript(60)

    const { rows } = await getDbPool().query(
      `select invoice_id, status from payment_orders
        where invoice_id in (
          'lc_terminal_paid','lc_terminal_failed','lc_terminal_cancelled'
        )`,
    )
    const byId = new Map(rows.map((r) => [r.invoice_id, r.status]))
    expect(byId.get('lc_terminal_paid')).toBe('paid')
    expect(byId.get('lc_terminal_failed')).toBe('failed')
    expect(byId.get('lc_terminal_cancelled')).toBe('cancelled')
  })

  it('floors the threshold to 30 minutes if a smaller value is set', async () => {
    await seedOrder({
      invoiceId: 'lc_threshold_floor',
      status: 'pending',
      ageMinutes: 10,
    })

    // Asks for 5 — script should refuse and use 30 instead. With age=10,
    // the order should NOT be cancelled.
    runScript(5)

    const { rows } = await getDbPool().query(
      `select status from payment_orders where invoice_id = $1`,
      ['lc_threshold_floor'],
    )
    expect(rows[0].status).toBe('pending')
  })
})
