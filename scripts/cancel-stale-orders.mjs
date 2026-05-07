#!/usr/bin/env node
//
// Hourly lifecycle cleanup. Cancels payment_orders that are still
// `pending` past the configured threshold (default 60 minutes).
//
// Why this script exists:
// CloudPayments invoices are physically dead ~20 minutes after creation
// (the user closed the widget, abandoned the form, or Cloudpayments
// itself timed out the session). Without a cleanup, those rows sit
// forever in `status = pending`, which:
//   - confuses the operator's view of "what's still in flight"
//   - skews the webhook-flow alert ratio (created vs paid+failed)
//   - blocks future analytics that bucket by terminal status
//
// What it does (per row, in one transaction):
//   1) UPDATE payment_orders set status='cancelled', updated_at=now(),
//      events = events || jsonb_build_array(<one event>) where the
//      event is { type:'payment.cancelled', source:'system',
//                 reason:'stale_pending_timeout', at:<iso> }
//   2) INSERT into payment_audit_events with event_type='order.cancelled',
//      actor='system', payload={ reason:'stale_pending_timeout',
//      threshold_minutes: <N>, age_minutes: <observed> }
//
// What it deliberately does NOT do:
//   - touch paid / failed / cancelled rows (untouchable; statuses are
//     terminal)
//   - delete anything (54-FZ requires keeping financial records ~5
//     years; this script only mutates a non-terminal pending row to
//     a terminal cancelled state)
//   - 3DS-aware filtering (3DS callbacks complete inside ~5 minutes;
//     a 60-minute threshold has 12x headroom)
//   - distinguish providers (mock orders that linger in prod are
//     equally dead; cancelling them is harmless)
//
// Failure mode:
//   - per-row tx errors are logged and skipped; script keeps going
//   - exit code 0 on any success or empty work; exit 1 only if every
//     candidate row failed (network gone)
//
// Configuration:
//   STALE_ORDER_THRESHOLD_MINUTES — defaults to 60, must be ≥ 30
//                                   (lower than 30 risks racing 3DS)
//
// Idempotence: re-running immediately is harmless — the row already
// has status='cancelled' and SELECT no longer matches it.

import pg from 'pg'

import { resolveSslConfig } from './_pg-ssl.mjs'

function logJson(level, msg, extra = {}) {
  console.log(
    JSON.stringify({
      level,
      ts: new Date().toISOString(),
      probe: 'cancel-stale-orders',
      msg,
      ...extra,
    }),
  )
}

function readThreshold() {
  const raw = process.env.STALE_ORDER_THRESHOLD_MINUTES?.trim() || ''
  if (!raw) return 60
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) return 60
  // Floor at 30 minutes so misconfiguration can't race 3DS callbacks.
  return Math.max(30, Math.floor(parsed))
}

async function main() {
  if (!process.env.DATABASE_URL) {
    logJson('error', 'DATABASE_URL not set; aborting')
    process.exit(2)
  }

  const thresholdMin = readThreshold()
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
    ssl: resolveSslConfig(process.env.DATABASE_URL),
  })

  let cancelled = 0
  let failed = 0

  try {
    const candidates = await pool.query(
      `select invoice_id,
              amount_rub,
              customer_email,
              created_at,
              extract(epoch from (now() - created_at))::int as age_seconds
         from payment_orders
        where status = 'pending'
          and created_at < now() - make_interval(mins => $1)
        order by created_at asc
        limit 1000`,
      [thresholdMin],
    )

    if (candidates.rows.length === 0) {
      logJson('info', 'no stale orders', { threshold_minutes: thresholdMin })
      return
    }

    logJson('info', 'found stale orders', {
      threshold_minutes: thresholdMin,
      count: candidates.rows.length,
    })

    for (const row of candidates.rows) {
      const invoiceId = String(row.invoice_id)
      const ageMinutes = Math.floor(Number(row.age_seconds) / 60)
      const amountRub = Number(row.amount_rub)
      const customerEmail = row.customer_email
        ? String(row.customer_email)
        : null
      const amountKopecks = Math.round(amountRub * 100)

      const client = await pool.connect()
      try {
        await client.query('begin')

        const event = {
          type: 'payment.cancelled',
          source: 'system',
          reason: 'stale_pending_timeout',
          ageMinutes,
          at: new Date().toISOString(),
        }

        const updateResult = await client.query(
          `update payment_orders
              set status = 'cancelled',
                  updated_at = now(),
                  provider_message = 'Заказ отменён системой по таймауту.',
                  events = events || $2::jsonb
            where invoice_id = $1
              and status = 'pending'`,
          [invoiceId, JSON.stringify([event])],
        )

        if (updateResult.rowCount === 0) {
          // Race: row's status already changed (e.g. webhook arrived
          // between our SELECT and UPDATE). Roll back, skip the audit
          // write — nothing to record on a no-op.
          await client.query('rollback')
          continue
        }

        await client.query(
          `insert into payment_audit_events (
             event_type, invoice_id, customer_email,
             amount_kopecks, from_status, to_status,
             actor, payload
           ) values (
             'order.cancelled', $1, $2,
             $3, 'pending', 'cancelled',
             'system', $4::jsonb
           )`,
          [
            invoiceId,
            customerEmail,
            amountKopecks,
            JSON.stringify({
              reason: 'stale_pending_timeout',
              threshold_minutes: thresholdMin,
              age_minutes: ageMinutes,
            }),
          ],
        )

        await client.query('commit')
        cancelled += 1
      } catch (rowErr) {
        await client.query('rollback').catch(() => {})
        failed += 1
        logJson('error', 'cancel failed for row', {
          invoice_id: invoiceId,
          error: rowErr instanceof Error ? rowErr.message : String(rowErr),
        })
      } finally {
        client.release()
      }
    }

    logJson('info', 'done', { cancelled, failed })

    if (cancelled === 0 && failed > 0) {
      process.exit(1)
    }
  } finally {
    await pool.end()
  }
}

main().catch((err) => {
  logJson('error', 'unhandled', {
    error: err instanceof Error ? err.message : String(err),
  })
  process.exit(1)
})
