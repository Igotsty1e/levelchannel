import { getDbPool } from '@/lib/db/pool'

// Webhook delivery dedup. Wraps `handleCloudPaymentsWebhook` so a
// retried delivery from CloudPayments (same TransactionId, same kind)
// returns the previously-stored response WITHOUT re-running the
// handler — no second markOrderPaid, no duplicate audit row, no
// duplicate operator email, no duplicate allocation insert.
//
// Why a separate module from `lib/security/idempotency.ts`:
//   - the idempotency module dedups on a CLIENT-supplied
//     `Idempotency-Key` header for our own POST `/api/payments` flow;
//     the key is request-body-bound and meant for client retries.
//   - this module dedups on a PROVIDER-supplied `TransactionId` for
//     incoming webhooks; the dedup is hash-bound to the provider's
//     transaction, not to a request body. Conflating the two
//     muddles two distinct trust boundaries.
//
// Race condition (rare but real): two concurrent retries arrive with
// the same TransactionId before the first finishes. Both pass the
// pre-handler lookup (no row yet), both run the handler, the second
// insert hits ON CONFLICT DO NOTHING and keeps the first's row. The
// handler-level operations are individually idempotent (markOrderPaid
// is paid→paid no-op; payment_allocations PK rejects dups; tokens
// upsert by email). Operator email may fire twice in the rare race;
// acceptable for an edge case CloudPayments does not exercise in
// practice (their retry cadence is minutes, not milliseconds).

let initPromise: Promise<void> | null = null

export type WebhookDeliveryOutcome = {
  status: number
  body: unknown
}

export async function ensureWebhookDeliveriesSchema(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      const pool = getDbPool()
      await pool.query(`
        create table if not exists webhook_deliveries (
          provider text not null,
          kind text not null,
          transaction_id text not null,
          invoice_id text null,
          response_status int not null,
          response_body jsonb not null,
          received_at timestamptz not null default now(),
          primary key (provider, kind, transaction_id),
          constraint webhook_deliveries_provider_check
            check (provider in ('cloudpayments')),
          constraint webhook_deliveries_kind_check
            check (kind in ('check', 'pay', 'fail'))
        )
      `)
      await pool.query(`
        create index if not exists webhook_deliveries_received_at_idx
          on webhook_deliveries (received_at)
      `)
      await pool.query(`
        create index if not exists webhook_deliveries_invoice_idx
          on webhook_deliveries (invoice_id)
          where invoice_id is not null
      `)
    })().catch((error) => {
      initPromise = null
      throw error
    })
  }

  await initPromise
}

export async function lookupWebhookDelivery(
  provider: string,
  kind: string,
  transactionId: string,
): Promise<WebhookDeliveryOutcome | null> {
  const pool = getDbPool()
  const result = await pool.query(
    `select response_status, response_body
     from webhook_deliveries
     where provider = $1 and kind = $2 and transaction_id = $3`,
    [provider, kind, transactionId],
  )

  if (result.rows.length === 0) {
    return null
  }

  const row = result.rows[0]
  return {
    status: Number(row.response_status),
    body: row.response_body as unknown,
  }
}

export async function recordWebhookDelivery(opts: {
  provider: string
  kind: string
  transactionId: string
  invoiceId: string | null
  outcome: WebhookDeliveryOutcome
}): Promise<void> {
  const pool = getDbPool()
  // ON CONFLICT DO NOTHING — the rare race where two retries finish
  // at almost the same time. The first row wins; the second is
  // silently dropped here. The handler-side already produced both
  // (idempotent at the data layer per module-level comment).
  await pool.query(
    `insert into webhook_deliveries (
      provider, kind, transaction_id, invoice_id,
      response_status, response_body
    ) values ($1, $2, $3, $4, $5, $6::jsonb)
    on conflict (provider, kind, transaction_id) do nothing`,
    [
      opts.provider,
      opts.kind,
      opts.transactionId,
      opts.invoiceId,
      opts.outcome.status,
      JSON.stringify(opts.outcome.body),
    ],
  )
}

// Best-effort cleanup janitor. Webhook retention is 90 days — long
// enough to debug real production escalations without keeping the
// table unbounded. Mirrors `purgeStaleIdempotencyRecordsPostgres`.
export async function purgeStaleWebhookDeliveries(maxAgeDays = 90): Promise<void> {
  const pool = getDbPool()
  await pool.query(
    `delete from webhook_deliveries where received_at < now() - ($1::int || ' days')::interval`,
    [maxAgeDays],
  )
}
